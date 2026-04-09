const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'bin', 'multiagent-safety.js');

function run(args, cwd) {
  return cp.spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function initGitRepo(repoDir, withPackageJson = true) {
  fs.mkdirSync(repoDir, { recursive: true });

  let result = cp.spawnSync('git', ['init', '-b', 'dev'], { cwd: repoDir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  if (withPackageJson) {
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: path.basename(repoDir), private: true, scripts: {} }, null, 2) + '\n',
    );
  }

  result = cp.spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  result = cp.spawnSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

function assertRepoInstalled(repoDir) {
  const requiredFiles = [
    'scripts/agent-branch-start.sh',
    'scripts/agent-branch-finish.sh',
    'scripts/agent-file-locks.py',
    'scripts/install-agent-git-hooks.sh',
    '.githooks/pre-commit',
    '.omx/state/agent-file-locks.json',
    'AGENTS.md',
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(repoDir, relativePath)), true, `${relativePath} missing`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['agent:branch:start'], 'bash ./scripts/agent-branch-start.sh');
  assert.equal(packageJson.scripts['agent:locks:claim'], 'python3 ./scripts/agent-file-locks.py claim');

  const agentsContent = fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8');
  assert.equal(agentsContent.includes('<!-- multiagent-safety:START -->'), true);

  const hooksPath = cp.spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  assert.equal(hooksPath.status, 0, hooksPath.stderr);
  assert.equal(hooksPath.stdout.trim(), '.githooks');
}

test('install provisions workflow files and repo config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-'));
  const repoDir = path.join(tempDir, 'repo');
  initGitRepo(repoDir, true);

  const result = run(['install', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assertRepoInstalled(repoDir);

  const secondRun = run(['install', '--target', repoDir], repoDir);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
});

test('doctor passes on an installed repo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-doctor-pass-'));
  const repoDir = path.join(tempDir, 'repo');
  initGitRepo(repoDir, true);

  const installResult = run(['install', '--target', repoDir], repoDir);
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);

  const doctorResult = run(['doctor', '--target', repoDir], repoDir);
  assert.equal(doctorResult.status, 0, doctorResult.stderr || doctorResult.stdout);
  assert.match(doctorResult.stdout, /doctor passed/);
});

test('install-many applies guardrails across discovered workspace repos', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-many-'));
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const repoA = path.join(workspaceDir, 'repo-a');
  const repoB = path.join(workspaceDir, 'nested', 'repo-b');
  initGitRepo(repoA, true);
  initGitRepo(repoB, true);

  const result = run(['install-many', '--workspace', workspaceDir, '--max-depth', '3'], workspaceDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /install-many summary: installed=2, failures=0/);

  assertRepoInstalled(repoA);
  assertRepoInstalled(repoB);
});

test('install-many defaults to current workspace scan when no target options are passed', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-default-many-'));
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const repoA = path.join(workspaceDir, 'repo-a');
  const repoB = path.join(workspaceDir, 'nested', 'repo-b');
  initGitRepo(repoA, true);
  initGitRepo(repoB, true);

  const result = run(['install-many'], workspaceDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Defaulting to workspace scan/);
  assert.match(result.stdout, /install-many summary: installed=2, failures=0/);

  assertRepoInstalled(repoA);
  assertRepoInstalled(repoB);
});

test('init-workspace generates a targets file and install-many can consume it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-init-workspace-'));
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const repoA = path.join(workspaceDir, 'repo-a');
  const repoB = path.join(workspaceDir, 'nested', 'repo-b');
  initGitRepo(repoA, true);
  initGitRepo(repoB, true);

  const targetsPath = path.join(workspaceDir, '.multiagent-safety-targets.txt');
  const initResult = run(['init-workspace', '--workspace', workspaceDir], workspaceDir);
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
  assert.equal(fs.existsSync(targetsPath), true, 'targets file missing');

  const targetsContent = fs.readFileSync(targetsPath, 'utf8');
  assert.match(targetsContent, new RegExp(repoA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(targetsContent, new RegExp(repoB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const installResult = run(['install-many', '--targets-file', targetsPath], workspaceDir);
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);
  assert.match(installResult.stdout, /install-many summary: installed=2, failures=0/);

  assertRepoInstalled(repoA);
  assertRepoInstalled(repoB);
});

test('install-many reports failures for invalid targets while still installing valid repos', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-targets-'));
  const repoDir = path.join(tempDir, 'repo-good');
  initGitRepo(repoDir, true);

  const invalidTarget = path.join(tempDir, 'not-a-repo');
  fs.mkdirSync(invalidTarget, { recursive: true });

  const targetsFile = path.join(tempDir, 'targets.txt');
  fs.writeFileSync(targetsFile, `# sample targets\n${repoDir}\n${invalidTarget}\n`, 'utf8');

  const result = run(['install-many', '--targets-file', targetsFile], tempDir);
  assert.equal(result.status, 1, 'expected non-zero when one target fails');
  assert.match(result.stdout, /install-many summary: installed=1, failures=1/);
  assert.match(result.stderr, /install-many completed with 1 failure/);

  assertRepoInstalled(repoDir);
});

test('doctor fails when core pieces are missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-safety-doctor-fail-'));
  const repoDir = path.join(tempDir, 'repo');
  initGitRepo(repoDir, true);

  const doctorResult = run(['doctor', '--target', repoDir], repoDir);
  assert.equal(doctorResult.status, 1, 'expected doctor failure on uninstalled repo');
  assert.match(doctorResult.stdout, /missing .githooks\/pre-commit/);
  assert.match(doctorResult.stderr, /doctor detected configuration issues/);
});
