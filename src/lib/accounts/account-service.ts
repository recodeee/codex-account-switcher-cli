import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  resolveAccountsDir,
  resolveAuthPath,
  resolveCodexDir,
  resolveCurrentNamePath,
} from "../config/paths";
import {
  AccountNotFoundError,
  AccountNameInferenceError,
  AmbiguousAccountQueryError,
  AuthFileMissingError,
  AutoSwitchConfigError,
  InvalidAccountNameError,
  SnapshotEmailMismatchError,
} from "./errors";
import { parseAuthSnapshotFile } from "./auth-parser";
import {
  createDefaultRegistry,
  loadRegistry,
  reconcileRegistryWithAccounts,
  saveRegistry,
} from "./registry";
import {
  AccountMapping,
  AutoSwitchRunResult,
  ParsedAuthSnapshot,
  RegistryData,
  StatusReport,
  UsageSnapshot,
} from "./types";
import {
  fetchUsageFromApi,
  fetchUsageFromLocal,
  shouldSwitchCurrent,
  usageScore,
} from "./usage";
import {
  disableManagedService,
  enableManagedService,
  getManagedServiceState,
} from "./service-manager";

const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._@+-]*$/;

export interface AccountChoice {
  name: string;
  email?: string;
  active: boolean;
}

export interface RemoveResult {
  removed: string[];
  activated?: string;
}

export interface SaveAccountOptions {
  force?: boolean;
}

export interface ResolvedDefaultAccountName {
  name: string;
  source: "active" | "inferred";
}

export interface ResolvedLoginAccountName {
  name: string;
  source: "inferred";
}

export interface ExternalAuthSyncResult {
  synchronized: boolean;
  savedName?: string;
  autoSwitchDisabled: boolean;
}

export class AccountService {
  public async syncExternalAuthSnapshotIfNeeded(): Promise<ExternalAuthSyncResult> {
    const authPath = resolveAuthPath();
    if (!(await this.pathExists(authPath))) {
      return {
        synchronized: false,
        autoSwitchDisabled: false,
      };
    }

    await this.materializeAuthSymlink(authPath);

    const incomingSnapshot = await parseAuthSnapshotFile(authPath);
    if (incomingSnapshot.authMode !== "chatgpt") {
      return {
        synchronized: false,
        autoSwitchDisabled: false,
      };
    }

    const activeName = await this.getCurrentAccountName();
    if (activeName) {
      const activeSnapshotPath = this.accountFilePath(activeName);
      if (await this.pathExists(activeSnapshotPath)) {
        const activeSnapshot = await parseAuthSnapshotFile(activeSnapshotPath);
        if (this.snapshotsShareIdentity(activeSnapshot, incomingSnapshot)) {
          return {
            synchronized: false,
            autoSwitchDisabled: false,
          };
        }
      }
    }

    const status = await this.getStatus();
    const autoSwitchDisabled = status.autoSwitchEnabled;
    if (autoSwitchDisabled) {
      await this.setAutoSwitchEnabled(false);
    }

    const resolvedName = await this.resolveLoginAccountNameFromCurrentAuth();
    const savedName = await this.saveAccount(resolvedName.name);

    return {
      synchronized: true,
      savedName,
      autoSwitchDisabled,
    };
  }

  public async listAccountNames(): Promise<string[]> {
    const accountsDir = resolveAccountsDir();
    if (!(await this.pathExists(accountsDir))) {
      return [];
    }

    const entries = await fsp.readdir(accountsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "registry.json")
      .map((entry) => entry.name.replace(/\.json$/i, ""))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  public async listAccountChoices(): Promise<AccountChoice[]> {
    const [accounts, current, registry] = await Promise.all([
      this.listAccountNames(),
      this.getCurrentAccountName(),
      this.loadReconciledRegistry(),
    ]);

    return accounts.map((name) => ({
      name,
      email: registry.accounts[name]?.email,
      active: current === name,
    }));
  }

  public async listAccountMappings(): Promise<AccountMapping[]> {
    const [accounts, current, registry] = await Promise.all([
      this.listAccountNames(),
      this.getCurrentAccountName(),
      this.loadReconciledRegistry(),
    ]);

    return Promise.all(
      accounts.map(async (name) => {
        const entry = registry.accounts[name];
        let fallbackSnapshot: ParsedAuthSnapshot | undefined;

        if (!entry?.email || !entry?.accountId || !entry?.userId || !entry?.planType) {
          fallbackSnapshot = await parseAuthSnapshotFile(this.accountFilePath(name));
        }

        return {
          name,
          active: current === name,
          email: entry?.email ?? fallbackSnapshot?.email,
          accountId: entry?.accountId ?? fallbackSnapshot?.accountId,
          userId: entry?.userId ?? fallbackSnapshot?.userId,
          planType: entry?.planType ?? fallbackSnapshot?.planType,
          lastUsageAt: entry?.lastUsageAt,
          usageSource: entry?.lastUsage?.source,
        };
      }),
    );
  }

  public async findMatchingAccounts(query: string): Promise<AccountChoice[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const choices = await this.listAccountChoices();
    const registry = await this.loadReconciledRegistry();
    return choices.filter((choice) => {
      if (choice.name.toLowerCase().includes(normalized)) return true;
      if (choice.email && choice.email.toLowerCase().includes(normalized)) return true;
      const meta = registry.accounts[choice.name];
      if (meta?.accountId?.toLowerCase().includes(normalized)) return true;
      if (meta?.userId?.toLowerCase().includes(normalized)) return true;
      return false;
    });
  }

  public async getCurrentAccountName(): Promise<string | null> {
    const currentNamePath = resolveCurrentNamePath();
    const currentName = await this.readCurrentNameFile(currentNamePath);
    if (currentName) return currentName;

    const authPath = resolveAuthPath();
    if (!(await this.pathExists(authPath))) return null;

    const stat = await fsp.lstat(authPath);
    if (!stat.isSymbolicLink()) return null;

    const rawTarget = await fsp.readlink(authPath);
    const resolvedTarget = path.resolve(path.dirname(authPath), rawTarget);
    const accountsRoot = path.resolve(resolveAccountsDir());
    const relative = path.relative(accountsRoot, resolvedTarget);
    if (relative.startsWith("..")) return null;

    const base = path.basename(resolvedTarget);
    if (!base.endsWith(".json") || base === "registry.json") return null;
    return base.replace(/\.json$/i, "");
  }

  public async saveAccount(rawName: string, options?: SaveAccountOptions): Promise<string> {
    const name = this.normalizeAccountName(rawName);
    const authPath = resolveAuthPath();
    const accountsDir = resolveAccountsDir();

    await this.ensureAuthFileExists(authPath);
    await this.ensureDir(accountsDir);
    const destination = this.accountFilePath(name);
    await this.assertSafeSnapshotOverwrite({
      authPath,
      destinationPath: destination,
      accountName: name,
      force: Boolean(options?.force),
    });
    await fsp.copyFile(authPath, destination);

    await this.writeCurrentName(name);

    const registry = await this.loadReconciledRegistry();
    await this.hydrateSnapshotMetadata(registry, name);
    registry.activeAccountName = name;
    await this.persistRegistry(registry);

    return name;
  }

  public async inferAccountNameFromCurrentAuth(): Promise<string> {
    const authPath = resolveAuthPath();
    await this.ensureAuthFileExists(authPath);

    const parsed = await parseAuthSnapshotFile(authPath);
    const email = parsed.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new AccountNameInferenceError();
    }

    const baseCandidate = this.normalizeAccountName(email);
    const uniqueName = await this.resolveUniqueInferredName(baseCandidate, parsed);
    return uniqueName;
  }

  public async resolveDefaultAccountNameFromCurrentAuth(): Promise<ResolvedDefaultAccountName> {
    const authPath = resolveAuthPath();
    await this.ensureAuthFileExists(authPath);

    const activeName = await this.getCurrentAccountName();
    if (activeName) {
      const activeSnapshotPath = this.accountFilePath(activeName);
      if (await this.pathExists(activeSnapshotPath)) {
        const [activeSnapshot, incomingSnapshot] = await Promise.all([
          parseAuthSnapshotFile(activeSnapshotPath),
          parseAuthSnapshotFile(authPath),
        ]);

        if (this.snapshotsShareIdentity(activeSnapshot, incomingSnapshot)) {
          return {
            name: activeName,
            source: "active",
          };
        }
      }
    }

    return {
      name: await this.inferAccountNameFromCurrentAuth(),
      source: "inferred",
    };
  }

  public async resolveLoginAccountNameFromCurrentAuth(): Promise<ResolvedLoginAccountName> {
    return {
      name: await this.inferAccountNameFromCurrentAuth(),
      source: "inferred",
    };
  }

  public async useAccount(rawName: string): Promise<string> {
    const name = this.normalizeAccountName(rawName);
    await this.activateSnapshot(name);

    const registry = await this.loadReconciledRegistry();
    await this.hydrateSnapshotMetadata(registry, name);
    registry.activeAccountName = name;
    await this.persistRegistry(registry);

    return name;
  }

  public async removeAccounts(accountNames: string[]): Promise<RemoveResult> {
    const uniqueNames = [...new Set(accountNames.map((name) => this.normalizeAccountName(name)))];
    if (uniqueNames.length === 0) {
      return { removed: [] };
    }

    const current = await this.getCurrentAccountName();
    const registry = await this.loadReconciledRegistry();
    const removed: string[] = [];

    for (const name of uniqueNames) {
      const snapshotPath = this.accountFilePath(name);
      if (!(await this.pathExists(snapshotPath))) {
        throw new AccountNotFoundError(name);
      }

      await fsp.rm(snapshotPath, { force: true });
      delete registry.accounts[name];
      removed.push(name);
    }

    const removedSet = new Set(removed);
    let activated: string | undefined;

    if (current && removedSet.has(current)) {
      const remaining = (await this.listAccountNames()).filter((name) => !removedSet.has(name));
      if (remaining.length > 0) {
        const best = this.selectBestCandidateFromRegistry(remaining, registry);
        await this.activateSnapshot(best);
        activated = best;
        registry.activeAccountName = best;
      } else {
        await this.clearActivePointers();
        delete registry.activeAccountName;
      }
    } else if (registry.activeAccountName && removedSet.has(registry.activeAccountName)) {
      delete registry.activeAccountName;
    }

    await this.persistRegistry(registry);
    return {
      removed,
      activated,
    };
  }

  public async removeByQuery(query: string): Promise<RemoveResult> {
    const matches = await this.findMatchingAccounts(query);
    if (matches.length === 0) {
      throw new AccountNotFoundError(query);
    }
    if (matches.length > 1) {
      throw new AmbiguousAccountQueryError(query);
    }

    return this.removeAccounts([matches[0].name]);
  }

  public async removeAllAccounts(): Promise<RemoveResult> {
    const all = await this.listAccountNames();
    return this.removeAccounts(all);
  }

  public async getStatus(): Promise<StatusReport> {
    const registry = await this.loadReconciledRegistry();
    return {
      autoSwitchEnabled: registry.autoSwitch.enabled,
      serviceState: getManagedServiceState(),
      threshold5hPercent: registry.autoSwitch.threshold5hPercent,
      thresholdWeeklyPercent: registry.autoSwitch.thresholdWeeklyPercent,
      usageMode: registry.api.usage ? "api" : "local",
    };
  }

  public async setAutoSwitchEnabled(enabled: boolean): Promise<StatusReport> {
    const registry = await this.loadReconciledRegistry();
    registry.autoSwitch.enabled = enabled;

    if (enabled) {
      try {
        await enableManagedService();
      } catch (error) {
        registry.autoSwitch.enabled = false;
        await this.persistRegistry(registry);
        throw new AutoSwitchConfigError(
          `Failed to enable managed auto-switch service: ${(error as Error).message}`,
        );
      }
    } else {
      await disableManagedService();
    }

    await this.persistRegistry(registry);
    return this.getStatus();
  }

  public async setApiUsageEnabled(enabled: boolean): Promise<StatusReport> {
    const registry = await this.loadReconciledRegistry();
    registry.api.usage = enabled;
    await this.persistRegistry(registry);
    return this.getStatus();
  }

  public async configureAutoSwitchThresholds(input: {
    threshold5hPercent?: number;
    thresholdWeeklyPercent?: number;
  }): Promise<StatusReport> {
    const registry = await this.loadReconciledRegistry();

    if (typeof input.threshold5hPercent === "number") {
      if (!this.isValidPercent(input.threshold5hPercent)) {
        throw new AutoSwitchConfigError("`--5h` must be an integer from 1 to 100.");
      }
      registry.autoSwitch.threshold5hPercent = Math.round(input.threshold5hPercent);
    }

    if (typeof input.thresholdWeeklyPercent === "number") {
      if (!this.isValidPercent(input.thresholdWeeklyPercent)) {
        throw new AutoSwitchConfigError("`--weekly` must be an integer from 1 to 100.");
      }
      registry.autoSwitch.thresholdWeeklyPercent = Math.round(input.thresholdWeeklyPercent);
    }

    await this.persistRegistry(registry);
    return this.getStatus();
  }

  public async runAutoSwitchOnce(): Promise<AutoSwitchRunResult> {
    const registry = await this.loadReconciledRegistry();
    if (!registry.autoSwitch.enabled) {
      return { switched: false, reason: "auto-switch is disabled" };
    }

    const accountNames = await this.listAccountNames();
    if (accountNames.length === 0) {
      return { switched: false, reason: "no saved accounts" };
    }

    const active = (await this.getCurrentAccountName()) ?? registry.activeAccountName;
    if (!active || !accountNames.includes(active)) {
      return { switched: false, reason: "no active account" };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    const activeUsage = await this.refreshAccountUsage(registry, active, {
      preferApi: registry.api.usage,
      allowLocalFallback: true,
    });

    if (!shouldSwitchCurrent(activeUsage, {
      threshold5hPercent: registry.autoSwitch.threshold5hPercent,
      thresholdWeeklyPercent: registry.autoSwitch.thresholdWeeklyPercent,
    }, nowSeconds)) {
      await this.persistRegistry(registry);
      return { switched: false, reason: "active account is above configured thresholds" };
    }

    const currentScore = usageScore(activeUsage, nowSeconds) ?? 0;

    let bestCandidate: string | undefined;
    let bestScore = currentScore;

    for (const candidate of accountNames) {
      if (candidate === active) continue;

      const usage = await this.refreshAccountUsage(registry, candidate, {
        preferApi: registry.api.usage,
        allowLocalFallback: false,
      });

      const score = usageScore(usage, nowSeconds) ?? 100;
      if (!bestCandidate || score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }

    if (!bestCandidate || bestScore <= currentScore) {
      await this.persistRegistry(registry);
      return {
        switched: false,
        reason: "no candidate has better remaining quota",
      };
    }

    await this.activateSnapshot(bestCandidate);
    registry.activeAccountName = bestCandidate;
    await this.hydrateSnapshotMetadata(registry, bestCandidate);
    await this.persistRegistry(registry);

    return {
      switched: true,
      fromAccount: active,
      toAccount: bestCandidate,
      reason: "switched due to low credits on active account",
    };
  }

  public async runDaemon(mode: "once" | "watch"): Promise<void> {
    if (mode === "once") {
      await this.runAutoSwitchOnce();
      return;
    }

    for (;;) {
      try {
        await this.runAutoSwitchOnce();
      } catch {
        // keep daemon alive
      }
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  private selectBestCandidateFromRegistry(candidates: string[], registry: RegistryData): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    let best = candidates[0];
    let bestScore = usageScore(registry.accounts[best]?.lastUsage, nowSeconds) ?? -1;

    for (const candidate of candidates.slice(1)) {
      const score = usageScore(registry.accounts[candidate]?.lastUsage, nowSeconds) ?? -1;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  private async refreshAccountUsage(
    registry: RegistryData,
    accountName: string,
    options: { preferApi: boolean; allowLocalFallback: boolean },
  ): Promise<UsageSnapshot | undefined> {
    const snapshotPath = this.accountFilePath(accountName);
    const parsed = await parseAuthSnapshotFile(snapshotPath);

    const entry = registry.accounts[accountName] ?? {
      name: accountName,
      createdAt: new Date().toISOString(),
    };

    if (parsed.email) entry.email = parsed.email;
    if (parsed.accountId) entry.accountId = parsed.accountId;
    if (parsed.userId) entry.userId = parsed.userId;
    if (parsed.planType) entry.planType = parsed.planType;

    let usage: UsageSnapshot | null = null;
    if (options.preferApi) {
      usage = await fetchUsageFromApi(parsed);
    }

    if (!usage && options.allowLocalFallback) {
      usage = await fetchUsageFromLocal(resolveCodexDir());
    }

    if (usage) {
      entry.lastUsage = usage;
      entry.lastUsageAt = usage.fetchedAt;
      if (usage.planType) {
        entry.planType = usage.planType;
      }
    }

    registry.accounts[accountName] = entry;
    return entry.lastUsage;
  }

  private accountFilePath(name: string): string {
    return path.join(resolveAccountsDir(), `${name}.json`);
  }

  private normalizeAccountName(rawName: string | undefined): string {
    if (typeof rawName !== "string") {
      throw new InvalidAccountNameError();
    }

    const trimmed = rawName.trim();
    if (!trimmed.length) {
      throw new InvalidAccountNameError();
    }

    const withoutExtension = trimmed.replace(/\.json$/i, "");
    if (!ACCOUNT_NAME_PATTERN.test(withoutExtension)) {
      throw new InvalidAccountNameError();
    }

    return withoutExtension;
  }

  private isValidPercent(value: number): boolean {
    return Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 100;
  }

  private async ensureAuthFileExists(authPath: string): Promise<void> {
    if (!(await this.pathExists(authPath))) {
      throw new AuthFileMissingError(authPath);
    }
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fsp.mkdir(dirPath, { recursive: true });
  }

  private async materializeAuthSymlink(authPath: string): Promise<void> {
    const stat = await fsp.lstat(authPath);
    if (!stat.isSymbolicLink()) {
      return;
    }

    const snapshotData = await fsp.readFile(authPath);
    await this.removeIfExists(authPath);
    await fsp.writeFile(authPath, snapshotData);
  }

  private async assertSafeSnapshotOverwrite(input: {
    authPath: string;
    destinationPath: string;
    accountName: string;
    force: boolean;
  }): Promise<void> {
    if (input.force || !(await this.pathExists(input.destinationPath))) {
      return;
    }

    const [existingSnapshot, incomingSnapshot] = await Promise.all([
      parseAuthSnapshotFile(input.destinationPath),
      parseAuthSnapshotFile(input.authPath),
    ]);

    const existingEmail = existingSnapshot.email?.trim().toLowerCase();
    const incomingEmail = incomingSnapshot.email?.trim().toLowerCase();

    if (existingEmail && incomingEmail && existingEmail !== incomingEmail) {
      throw new SnapshotEmailMismatchError(input.accountName, existingEmail, incomingEmail);
    }

    if (this.snapshotsShareIdentity(existingSnapshot, incomingSnapshot)) return;

    if (!existingEmail || !incomingEmail) return;

    const existingIdentity = this.renderSnapshotIdentity(existingSnapshot, existingEmail);
    const incomingIdentity = this.renderSnapshotIdentity(incomingSnapshot, incomingEmail);
    throw new SnapshotEmailMismatchError(input.accountName, existingIdentity, incomingIdentity);
  }

  private async removeIfExists(target: string): Promise<void> {
    try {
      await fsp.rm(target, { force: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async writeCurrentName(name: string): Promise<void> {
    const currentNamePath = resolveCurrentNamePath();
    await this.ensureDir(path.dirname(currentNamePath));
    await fsp.writeFile(currentNamePath, `${name}\n`, "utf8");
  }

  private async readCurrentNameFile(currentNamePath: string): Promise<string | null> {
    try {
      const contents = await fsp.readFile(currentNamePath, "utf8");
      const trimmed = contents.trim();
      return trimmed.length ? trimmed : null;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fsp.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async hydrateSnapshotMetadata(registry: RegistryData, accountName: string): Promise<void> {
    const parsed = await parseAuthSnapshotFile(this.accountFilePath(accountName));
    const entry = registry.accounts[accountName] ?? {
      name: accountName,
      createdAt: new Date().toISOString(),
    };

    if (parsed.email) entry.email = parsed.email;
    if (parsed.accountId) entry.accountId = parsed.accountId;
    if (parsed.userId) entry.userId = parsed.userId;
    if (parsed.planType) entry.planType = parsed.planType;

    registry.accounts[accountName] = entry;
  }

  private async resolveUniqueInferredName(
    baseName: string,
    incomingSnapshot: ParsedAuthSnapshot,
  ): Promise<string> {
    const accountPathFor = (name: string): string => this.accountFilePath(name);
    const hasMatchingIdentity = async (name: string): Promise<boolean> => {
      const parsed = await parseAuthSnapshotFile(accountPathFor(name));
      return this.snapshotsShareIdentity(parsed, incomingSnapshot);
    };

    const basePath = accountPathFor(baseName);
    if (!(await this.pathExists(basePath))) {
      return baseName;
    }
    if (await hasMatchingIdentity(baseName)) {
      return baseName;
    }

    for (let i = 2; i <= 99; i += 1) {
      const candidate = this.normalizeAccountName(`${baseName}--dup-${i}`);
      const candidatePath = accountPathFor(candidate);
      if (!(await this.pathExists(candidatePath))) {
        return candidate;
      }
      if (await hasMatchingIdentity(candidate)) {
        return candidate;
      }
    }

    throw new AccountNameInferenceError();
  }

  private async loadReconciledRegistry(): Promise<RegistryData> {
    const accountNames = await this.listAccountNames();
    const loaded = await loadRegistry();
    const base = loaded.version === 1 ? loaded : createDefaultRegistry();
    return reconcileRegistryWithAccounts(base, accountNames);
  }

  private async persistRegistry(registry: RegistryData): Promise<void> {
    const reconciled = reconcileRegistryWithAccounts(registry, await this.listAccountNames());
    await saveRegistry(reconciled);
  }

  private async activateSnapshot(accountName: string): Promise<void> {
    const name = this.normalizeAccountName(accountName);
    const source = this.accountFilePath(name);

    if (!(await this.pathExists(source))) {
      throw new AccountNotFoundError(name);
    }

    const authPath = resolveAuthPath();
    await this.ensureDir(path.dirname(authPath));
    await fsp.copyFile(source, authPath);

    await this.writeCurrentName(name);
  }

  private async clearActivePointers(): Promise<void> {
    const currentPath = resolveCurrentNamePath();
    const authPath = resolveAuthPath();
    await this.removeIfExists(currentPath);
    await this.removeIfExists(authPath);
  }

  private snapshotsShareIdentity(a: ParsedAuthSnapshot, b: ParsedAuthSnapshot): boolean {
    if (a.authMode !== "chatgpt" || b.authMode !== "chatgpt") {
      return false;
    }

    if (a.userId && b.userId && a.accountId && b.accountId) {
      return a.userId === b.userId && a.accountId === b.accountId;
    }

    if (a.accountId && b.accountId) {
      return a.accountId === b.accountId;
    }

    if (a.userId && b.userId) {
      return a.userId === b.userId;
    }

    const aEmail = a.email?.trim().toLowerCase();
    const bEmail = b.email?.trim().toLowerCase();
    if (aEmail && bEmail) {
      return aEmail === bEmail;
    }

    return false;
  }

  private renderSnapshotIdentity(snapshot: ParsedAuthSnapshot, fallbackEmail: string): string {
    const parts = [fallbackEmail];
    if (snapshot.accountId) parts.push(`account:${snapshot.accountId}`);
    if (snapshot.userId) parts.push(`user:${snapshot.userId}`);
    return parts.join(" | ");
  }
}
