#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const TEMPLATE_ROOT = path.resolve(__dirname, '..', 'templates');

const TEMPLATE_FILES = [
  'scripts/agent-branch-start.sh',
  'scripts/agent-branch-finish.sh',
  'scripts/agent-file-locks.py',
  'scripts/install-agent-git-hooks.sh',
  'githooks/pre-commit',
];

const REQUIRED_WORKFLOW_FILES = [
  'scripts/agent-branch-start.sh',
  'scripts/agent-branch-finish.sh',
  'scripts/agent-file-locks.py',
  'scripts/install-agent-git-hooks.sh',
  '.githooks/pre-commit',
  '.omx/state/agent-file-locks.json',
];

const REQUIRED_PACKAGE_SCRIPTS = {
  'agent:branch:start': 'bash ./scripts/agent-branch-start.sh',
  'agent:branch:finish': 'bash ./scripts/agent-branch-finish.sh',
  'agent:hooks:install': 'bash ./scripts/install-agent-git-hooks.sh',
  'agent:locks:claim': 'python3 ./scripts/agent-file-locks.py claim',
  'agent:locks:release': 'python3 ./scripts/agent-file-locks.py release',
  'agent:locks:status': 'python3 ./scripts/agent-file-locks.py status',
};

const EXECUTABLE_RELATIVE_PATHS = new Set([
  'scripts/agent-branch-start.sh',
  'scripts/agent-branch-finish.sh',
  'scripts/agent-file-locks.py',
  'scripts/install-agent-git-hooks.sh',
  '.githooks/pre-commit',
]);

const AGENTS_MARKER_START = '<!-- multiagent-safety:START -->';
const DEFAULT_INSTALL_MANY_MAX_DEPTH = 2;
const DEFAULT_WORKSPACE_TARGETS_FILE = '.multiagent-safety-targets.txt';
const WORKSPACE_SCAN_IGNORE = new Set([
  '.git',
  '.hg',
  '.svn',
  '.omx',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
]);

function usage() {
  console.log(`multiagent-safety v${packageJson.version}

Usage:
  multiagent-safety install [--target <path>] [--force] [--skip-agents] [--skip-package-json] [--dry-run]
  multiagent-safety install-many [--workspace <path>] [--max-depth <n>] [--target <path>] [--targets <a,b,c>] [--targets-file <file>] [--force] [--skip-agents] [--skip-package-json] [--dry-run] [--fail-fast]
  multiagent-safety init-workspace [--workspace <path>] [--max-depth <n>] [--output <file>] [--force]
  multiagent-safety doctor [--target <path>] [--strict]
  multiagent-safety print-agents-snippet
  multiagent-safety --help

Examples:
  multiagent-safety install
  multiagent-safety install-many
  multiagent-safety install --target ~/projects/my-repo
  multiagent-safety install-many --workspace ~/projects --max-depth 2
  multiagent-safety install-many --targets ~/repo-a,~/repo-b
  multiagent-safety install-many --targets-file ./workspace-repos.txt
  multiagent-safety init-workspace --workspace ~/projects
  multiagent-safety doctor
  multiagent-safety doctor --target ~/projects/repo-a --strict
  npm i -g multiagent-safety && multiagent-safety install`);
}

function run(cmd, args, options = {}) {
  return cp.spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    cwd: options.cwd,
  });
}

function resolveRepoRoot(targetPath) {
  const resolvedTarget = path.resolve(targetPath || process.cwd());
  const result = run('git', ['-C', resolvedTarget, 'rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(
      `Target is not inside a git repository: ${resolvedTarget}${stderr ? `\n${stderr}` : ''}`,
    );
  }
  return result.stdout.trim();
}

function toDestinationPath(relativeTemplatePath) {
  if (relativeTemplatePath.startsWith('scripts/')) {
    return relativeTemplatePath;
  }
  if (relativeTemplatePath.startsWith('githooks/')) {
    return `.${relativeTemplatePath}`;
  }
  throw new Error(`Unsupported template path: ${relativeTemplatePath}`);
}

function ensureParentDir(filePath, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyTemplateFile(repoRoot, relativeTemplatePath, force, dryRun) {
  const sourcePath = path.join(TEMPLATE_ROOT, relativeTemplatePath);
  const destinationRelativePath = toDestinationPath(relativeTemplatePath);
  const destinationPath = path.join(repoRoot, destinationRelativePath);

  const sourceContent = fs.readFileSync(sourcePath, 'utf8');
  const destinationExists = fs.existsSync(destinationPath);

  if (destinationExists) {
    const existingContent = fs.readFileSync(destinationPath, 'utf8');
    if (existingContent === sourceContent) {
      if (!dryRun && EXECUTABLE_RELATIVE_PATHS.has(destinationRelativePath)) {
        fs.chmodSync(destinationPath, 0o755);
      }
      return { status: 'unchanged', file: destinationRelativePath };
    }
    if (!force) {
      throw new Error(
        `Refusing to overwrite existing file without --force: ${destinationRelativePath}`,
      );
    }
  }

  ensureParentDir(destinationPath, dryRun);

  if (!dryRun) {
    fs.writeFileSync(destinationPath, sourceContent, 'utf8');
    if (EXECUTABLE_RELATIVE_PATHS.has(destinationRelativePath)) {
      fs.chmodSync(destinationPath, 0o755);
    }
  }

  return { status: destinationExists ? 'overwritten' : 'created', file: destinationRelativePath };
}

function ensureLockRegistry(repoRoot, dryRun) {
  const relativePath = '.omx/state/agent-file-locks.json';
  const absolutePath = path.join(repoRoot, relativePath);
  if (fs.existsSync(absolutePath)) {
    return { status: 'unchanged', file: relativePath };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify({ locks: {} }, null, 2) + '\n', 'utf8');
  }
  return { status: 'created', file: relativePath };
}

function ensurePackageScripts(repoRoot, dryRun) {
  const relativePath = 'package.json';
  const packagePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(packagePath)) {
    return { status: 'skipped', file: relativePath, note: 'package.json not found' };
  }

  const content = fs.readFileSync(packagePath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch (error) {
    throw new Error(`Unable to parse package.json in target repo: ${error.message}`);
  }

  pkg.scripts = pkg.scripts || {};
  let changed = false;
  for (const [key, value] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
    if (pkg.scripts[key] !== value) {
      pkg.scripts[key] = value;
      changed = true;
    }
  }

  if (!changed) {
    return { status: 'unchanged', file: relativePath };
  }

  if (!dryRun) {
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return { status: 'updated', file: relativePath };
}

function ensureAgentsSnippet(repoRoot, dryRun) {
  const relativePath = 'AGENTS.md';
  const agentsPath = path.join(repoRoot, relativePath);
  const snippet = fs
    .readFileSync(path.join(TEMPLATE_ROOT, 'AGENTS.multiagent-safety.md'), 'utf8')
    .trimEnd();

  if (!fs.existsSync(agentsPath)) {
    if (!dryRun) {
      fs.writeFileSync(agentsPath, `# AGENTS\n\n${snippet}\n`, 'utf8');
    }
    return { status: 'created', file: relativePath };
  }

  const existing = fs.readFileSync(agentsPath, 'utf8');
  if (existing.includes(AGENTS_MARKER_START)) {
    return { status: 'unchanged', file: relativePath };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  if (!dryRun) {
    fs.writeFileSync(agentsPath, `${existing}${separator}${snippet}\n`, 'utf8');
  }

  return { status: 'updated', file: relativePath };
}

function configureHooks(repoRoot, dryRun) {
  if (dryRun) {
    return { status: 'would-set', key: 'core.hooksPath', value: '.githooks' };
  }
  const result = run('git', ['-C', repoRoot, 'config', 'core.hooksPath', '.githooks']);
  if (result.status !== 0) {
    throw new Error(`Failed to set git hooksPath: ${(result.stderr || '').trim()}`);
  }
  return { status: 'set', key: 'core.hooksPath', value: '.githooks' };
}

function parseSharedInstallFlag(arg, options) {
  if (arg === '--force' || arg === '-f') {
    options.force = true;
    return true;
  }
  if (arg === '--skip-agents' || arg === '-A') {
    options.skipAgents = true;
    return true;
  }
  if (arg === '--skip-package-json' || arg === '-P') {
    options.skipPackageJson = true;
    return true;
  }
  if (arg === '--dry-run' || arg === '-n') {
    options.dryRun = true;
    return true;
  }
  return false;
}

function requireValue(rawArgs, index, flagName) {
  const value = rawArgs[index + 1];
  if (value === undefined || value === '') {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parseInstallArgs(rawArgs) {
  const options = {
    target: process.cwd(),
    force: false,
    skipAgents: false,
    skipPackageJson: false,
    dryRun: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target' || arg === '-t') {
      options.target = requireValue(rawArgs, index, '--target');
      index += 1;
      continue;
    }

    if (parseSharedInstallFlag(arg, options)) {
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function parseDoctorArgs(rawArgs) {
  const options = {
    target: process.cwd(),
    strict: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--target' || arg === '-t') {
      options.target = requireValue(rawArgs, index, '--target');
      index += 1;
      continue;
    }
    if (arg === '--strict' || arg === '-s') {
      options.strict = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function splitCsvTargets(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function readTargetsFile(targetsFilePath) {
  const absolutePath = path.resolve(targetsFilePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Targets file not found: ${absolutePath}`);
  }

  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/);
  const targets = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line.includes(',')) {
      targets.push(...splitCsvTargets(line));
      continue;
    }

    targets.push(line);
  }

  return targets;
}

function discoverGitRepos(workspaceRoot, maxDepth) {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  if (!fs.existsSync(resolvedWorkspace)) {
    throw new Error(`Workspace path does not exist: ${resolvedWorkspace}`);
  }

  let workspaceStats;
  try {
    workspaceStats = fs.statSync(resolvedWorkspace);
  } catch (error) {
    throw new Error(`Unable to read workspace path: ${resolvedWorkspace} (${error.message})`);
  }

  if (!workspaceStats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${resolvedWorkspace}`);
  }

  const repos = [];

  function walk(currentDir, depth) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.name === '.git')) {
      repos.push(currentDir);
      return;
    }

    if (depth >= maxDepth) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (WORKSPACE_SCAN_IGNORE.has(entry.name)) {
        continue;
      }
      walk(path.join(currentDir, entry.name), depth + 1);
    }
  }

  walk(resolvedWorkspace, 0);
  return repos;
}

function parseInstallManyArgs(rawArgs) {
  const options = {
    targets: [],
    targetsFile: null,
    workspace: null,
    maxDepth: DEFAULT_INSTALL_MANY_MAX_DEPTH,
    failFast: false,
    usedImplicitWorkspaceDefault: false,
    force: false,
    skipAgents: false,
    skipPackageJson: false,
    dryRun: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--target' || arg === '-t') {
      options.targets.push(requireValue(rawArgs, index, '--target'));
      index += 1;
      continue;
    }

    if (arg === '--targets' || arg === '-l') {
      options.targets.push(...splitCsvTargets(requireValue(rawArgs, index, '--targets')));
      index += 1;
      continue;
    }

    if (arg === '--targets-file' || arg === '-T') {
      options.targetsFile = requireValue(rawArgs, index, '--targets-file');
      index += 1;
      continue;
    }

    if (arg === '--workspace' || arg === '-w') {
      options.workspace = requireValue(rawArgs, index, '--workspace');
      index += 1;
      continue;
    }

    if (arg === '--max-depth' || arg === '-d') {
      const rawDepth = requireValue(rawArgs, index, '--max-depth');
      const parsedDepth = Number.parseInt(rawDepth, 10);
      if (!Number.isInteger(parsedDepth) || parsedDepth < 0) {
        throw new Error(`--max-depth must be a non-negative integer (received: ${rawDepth})`);
      }
      options.maxDepth = parsedDepth;
      index += 1;
      continue;
    }

    if (arg === '--fail-fast' || arg === '-x') {
      options.failFast = true;
      continue;
    }

    if (parseSharedInstallFlag(arg, options)) {
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.targets.length && !options.targetsFile && !options.workspace) {
    options.workspace = process.cwd();
    options.usedImplicitWorkspaceDefault = true;
  }

  return options;
}

function parseInitWorkspaceArgs(rawArgs) {
  const options = {
    workspace: process.cwd(),
    maxDepth: DEFAULT_INSTALL_MANY_MAX_DEPTH,
    output: null,
    force: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--workspace' || arg === '-w') {
      options.workspace = requireValue(rawArgs, index, '--workspace');
      index += 1;
      continue;
    }
    if (arg === '--max-depth' || arg === '-d') {
      const rawDepth = requireValue(rawArgs, index, '--max-depth');
      const parsedDepth = Number.parseInt(rawDepth, 10);
      if (!Number.isInteger(parsedDepth) || parsedDepth < 0) {
        throw new Error(`--max-depth must be a non-negative integer (received: ${rawDepth})`);
      }
      options.maxDepth = parsedDepth;
      index += 1;
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      options.output = requireValue(rawArgs, index, '--output');
      index += 1;
      continue;
    }
    if (arg === '--force' || arg === '-f') {
      options.force = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function collectInstallManyTargets(options) {
  const collected = [];

  if (options.targets.length) {
    collected.push(...options.targets);
  }

  if (options.targetsFile) {
    collected.push(...readTargetsFile(options.targetsFile));
  }

  if (options.workspace) {
    collected.push(...discoverGitRepos(options.workspace, options.maxDepth));
  }

  const deduped = [];
  const seen = new Set();
  for (const target of collected) {
    const normalized = path.resolve(target);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function installIntoRepoRoot(repoRoot, options) {
  const operations = [];

  for (const templateFile of TEMPLATE_FILES) {
    operations.push(copyTemplateFile(repoRoot, templateFile, options.force, options.dryRun));
  }

  operations.push(ensureLockRegistry(repoRoot, options.dryRun));

  if (!options.skipPackageJson) {
    operations.push(ensurePackageScripts(repoRoot, options.dryRun));
  }

  if (!options.skipAgents) {
    operations.push(ensureAgentsSnippet(repoRoot, options.dryRun));
  }

  const hookResult = configureHooks(repoRoot, options.dryRun);

  return {
    repoRoot,
    operations,
    hookResult,
  };
}

function printInstallReport(report) {
  console.log(`[multiagent-safety] Target repo: ${report.repoRoot}`);
  for (const operation of report.operations) {
    const note = operation.note ? ` (${operation.note})` : '';
    console.log(`  - ${operation.status.padEnd(10)} ${operation.file}${note}`);
  }
  console.log(`  - hooksPath  ${report.hookResult.status} ${report.hookResult.key}=${report.hookResult.value}`);
}

function install(rawArgs) {
  const options = parseInstallArgs(rawArgs);
  const repoRoot = resolveRepoRoot(options.target);

  const report = installIntoRepoRoot(repoRoot, options);
  printInstallReport(report);

  if (options.dryRun) {
    console.log('[multiagent-safety] Dry run complete. No files were modified.');
  } else {
    console.log('[multiagent-safety] Installed multi-agent safety workflow.');
    console.log('[multiagent-safety] Next step: run `python3 scripts/agent-file-locks.py status` in the repo.');
  }
}

function installMany(rawArgs) {
  const options = parseInstallManyArgs(rawArgs);
  const targets = collectInstallManyTargets(options);

  if (!targets.length) {
    throw new Error('install-many did not find any targets to process.');
  }

  if (options.usedImplicitWorkspaceDefault) {
    console.log(
      `[multiagent-safety] No explicit targets provided. Defaulting to workspace scan: ${path.resolve(
        options.workspace,
      )} (max depth ${options.maxDepth})`,
    );
  }

  console.log(
    `[multiagent-safety] install-many starting for ${targets.length} target path(s)${
      options.dryRun ? ' [dry-run]' : ''
    }`,
  );

  let installed = 0;
  let duplicateRepos = 0;
  const seenRepoRoots = new Set();
  const failures = [];

  for (const targetPath of targets) {
    let repoRoot;
    try {
      repoRoot = resolveRepoRoot(targetPath);
    } catch (error) {
      failures.push({ target: targetPath, message: error.message });
      if (options.failFast) {
        break;
      }
      continue;
    }

    if (seenRepoRoots.has(repoRoot)) {
      duplicateRepos += 1;
      console.log(`[multiagent-safety] Skipping duplicate repo target: ${targetPath} -> ${repoRoot}`);
      continue;
    }

    seenRepoRoots.add(repoRoot);

    try {
      const report = installIntoRepoRoot(repoRoot, options);
      printInstallReport(report);
      installed += 1;
    } catch (error) {
      failures.push({ target: repoRoot, message: error.message });
      if (options.failFast) {
        break;
      }
    }
  }

  console.log(
    `[multiagent-safety] install-many summary: installed=${installed}, failures=${failures.length}, duplicate-targets=${duplicateRepos}`,
  );

  if (failures.length > 0) {
    console.error('[multiagent-safety] Failed targets:');
    for (const failure of failures) {
      console.error(`  - ${failure.target}`);
      console.error(`    ${failure.message}`);
    }
    throw new Error(`install-many completed with ${failures.length} failure(s)`);
  }

  if (options.dryRun) {
    console.log('[multiagent-safety] Dry run complete. No files were modified.');
  } else {
    console.log('[multiagent-safety] Installed multi-agent safety workflow across all targets.');
  }
}

function initWorkspace(rawArgs) {
  const options = parseInitWorkspaceArgs(rawArgs);
  const resolvedWorkspace = path.resolve(options.workspace);
  const repos = discoverGitRepos(resolvedWorkspace, options.maxDepth)
    .map((repoPath) => path.resolve(repoPath))
    .sort();

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(resolvedWorkspace, DEFAULT_WORKSPACE_TARGETS_FILE);

  if (fs.existsSync(outputPath) && !options.force) {
    throw new Error(`Refusing to overwrite existing file without --force: ${outputPath}`);
  }

  const headerLines = [
    '# multiagent-safety workspace targets',
    `# generated: ${new Date().toISOString()}`,
    `# workspace: ${resolvedWorkspace}`,
    `# max-depth: ${options.maxDepth}`,
    '#',
    '# Run:',
    `# multiagent-safety install-many --targets-file "${outputPath}"`,
    '',
  ];
  const content = `${headerLines.join('\n')}${repos.join('\n')}${repos.length ? '\n' : ''}`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');

  console.log(`[multiagent-safety] Workspace target file written: ${outputPath}`);
  console.log(`[multiagent-safety] Repos discovered: ${repos.length}`);
  if (repos.length === 0) {
    console.log('[multiagent-safety] No git repos found. You can add target paths manually to the file.');
  } else {
    console.log(`[multiagent-safety] Next step: multiagent-safety install-many --targets-file "${outputPath}"`);
  }
}

function doctor(rawArgs) {
  const options = parseDoctorArgs(rawArgs);
  const repoRoot = resolveRepoRoot(options.target);
  const failures = [];
  const warnings = [];

  function ok(message) {
    console.log(`  [ok]   ${message}`);
  }
  function warn(message) {
    warnings.push(message);
    console.log(`  [warn] ${message}`);
  }
  function fail(message) {
    failures.push(message);
    console.log(`  [fail] ${message}`);
  }

  console.log(`[multiagent-safety] doctor target: ${repoRoot}`);

  const hooksPath = run('git', ['-C', repoRoot, 'config', '--get', 'core.hooksPath']);
  if (hooksPath.status !== 0) {
    fail('git core.hooksPath is not configured');
  } else if (hooksPath.stdout.trim() !== '.githooks') {
    fail(`git core.hooksPath is "${hooksPath.stdout.trim()}" (expected ".githooks")`);
  } else {
    ok('git core.hooksPath is .githooks');
  }

  for (const relativePath of REQUIRED_WORKFLOW_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      fail(`missing ${relativePath}`);
      continue;
    }
    ok(`found ${relativePath}`);

    if (EXECUTABLE_RELATIVE_PATHS.has(relativePath)) {
      try {
        fs.accessSync(absolutePath, fs.constants.X_OK);
      } catch {
        fail(`${relativePath} exists but is not executable`);
      }
    }
  }

  const lockFilePath = path.join(repoRoot, '.omx/state/agent-file-locks.json');
  if (fs.existsSync(lockFilePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.locks !== 'object') {
        fail('.omx/state/agent-file-locks.json does not contain a valid { locks: {} } object');
      } else {
        ok('lock registry JSON is valid');
      }
    } catch (error) {
      fail(`lock registry JSON is invalid: ${error.message}`);
    }
  }

  const packagePath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packagePath)) {
    warn('package.json not found (npm helper scripts cannot be verified)');
  } else {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const scripts = pkg.scripts || {};
      for (const [name, expectedValue] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
        if (scripts[name] !== expectedValue) {
          fail(`package.json script mismatch for "${name}"`);
        } else {
          ok(`package.json script "${name}" is configured`);
        }
      }
    } catch (error) {
      fail(`package.json is invalid JSON: ${error.message}`);
    }
  }

  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    warn('AGENTS.md not found (multi-agent contract snippet not present)');
  } else {
    const agentsContent = fs.readFileSync(agentsPath, 'utf8');
    if (!agentsContent.includes(AGENTS_MARKER_START)) {
      warn('AGENTS.md exists but multiagent-safety snippet marker is missing');
    } else {
      ok('AGENTS.md contains multiagent-safety snippet marker');
    }
  }

  if (warnings.length) {
    console.log(`[multiagent-safety] warnings: ${warnings.length}`);
  }
  if (failures.length) {
    console.log(`[multiagent-safety] failures: ${failures.length}`);
  }

  if (failures.length === 0 && (!options.strict || warnings.length === 0)) {
    console.log('[multiagent-safety] doctor passed.');
    if (warnings.length > 0) {
      console.log('[multiagent-safety] tip: run with --strict to treat warnings as failures.');
    }
    return;
  }

  if (options.strict && warnings.length > 0 && failures.length === 0) {
    console.log('[multiagent-safety] strict mode failed due to warnings.');
  } else {
    console.log('[multiagent-safety] doctor failed.');
  }
  throw new Error('doctor detected configuration issues');
}

function printAgentsSnippet() {
  const snippetPath = path.join(TEMPLATE_ROOT, 'AGENTS.multiagent-safety.md');
  process.stdout.write(fs.readFileSync(snippetPath, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    install([]);
    return;
  }

  const [command, ...rest] = args;
  if (command === '--help' || command === '-h' || command === 'help') {
    usage();
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(packageJson.version);
    return;
  }
  if (command === 'install') {
    install(rest);
    return;
  }
  if (command === 'install-many') {
    installMany(rest);
    return;
  }
  if (command === 'init-workspace') {
    initWorkspace(rest);
    return;
  }
  if (command === 'doctor') {
    doctor(rest);
    return;
  }
  if (command === 'workspace') {
    installMany(['--workspace', process.cwd(), ...rest]);
    return;
  }
  if (command === 'print-agents-snippet') {
    printAgentsSnippet();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`[multiagent-safety] ${error.message}`);
  process.exitCode = 1;
}
