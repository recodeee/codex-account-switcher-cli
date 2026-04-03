export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthFileMissingError extends CodexAuthError {
  constructor(targetPath: string) {
    super(
      `No Codex auth file found at ${targetPath}. ` +
        `Log into Codex first so ~/.codex/auth.json exists.`,
    );
  }
}

export class AccountNotFoundError extends CodexAuthError {
  constructor(accountName: string) {
    super(`No saved Codex account named "${accountName}" was found.`);
  }
}

export class NoAccountsSavedError extends CodexAuthError {
  constructor() {
    super(`No saved Codex accounts yet. Run "codex-auth save <name>" first.`);
  }
}

export class InvalidAccountNameError extends CodexAuthError {
  constructor() {
    super(
      "Account names must include at least one non-space character and " +
        "may contain letters, numbers, dashes, underscores, and dots.",
    );
  }
}

export class AccountNameInferenceError extends CodexAuthError {
  constructor() {
    super("Could not infer account name from auth email. Pass one explicitly: codex-auth save <name>.");
  }
}

export class SnapshotEmailMismatchError extends CodexAuthError {
  constructor(accountName: string, existingEmail: string, incomingEmail: string) {
    super(
      `Refusing to overwrite snapshot "${accountName}" because it belongs to ` +
        `${existingEmail}, but current auth is ${incomingEmail}. ` +
        `Use a different name, run "codex-auth remove ${accountName}" first, or re-run with --force.`,
    );
  }
}

export class PromptCancelledError extends CodexAuthError {
  constructor() {
    super("No account selected. The operation was cancelled.");
  }
}

export class InvalidRemoveSelectionError extends CodexAuthError {
  constructor() {
    super("No accounts were selected for removal.");
  }
}

export class AmbiguousAccountQueryError extends CodexAuthError {
  constructor(query: string) {
    super(`Query "${query}" matched multiple accounts. Refine the query or use interactive mode.`);
  }
}

export class AutoSwitchConfigError extends CodexAuthError {
  constructor(message: string) {
    super(message);
  }
}
