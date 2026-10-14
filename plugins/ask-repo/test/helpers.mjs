// Run from the repo root: node --test plugins/ask-repo/test/*.test.mjs
//
// Shared by the *.test.mjs files: a throwaway folder per test holding a registry, a target repo
// and a project to ask from, and a runner for bin/ask-repo the way the agent's Bash calls it, with
// test/fake-claude.mjs in place of claude.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FAKE_CLAUDE = path.join(PLUGIN_ROOT, 'test', 'fake-claude.mjs');

/** The parent environment without anything from the session running the tests or from git. */
export function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ASK_REPO_|FAKE_CLAUDE_|GIT_)/i.test(key))
  );
  return { ...env, ...extra };
}

export const git = (root, ...args) =>
  execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    env: cleanEnv({ GIT_CONFIG_NOSYSTEM: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * A fresh temporary folder, removed when the test ends, holding `target/` (the repo asked about),
 * `project/` (a git repo the question is asked from) and the registry file. `env` points ask-repo
 * at both and at the fake claude. Paths are real paths: on macOS os.tmpdir() is a symlink.
 */
export function setup(t) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ask-repo-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'target');
  const project = path.join(dir, 'project');
  mkdirSync(target);
  mkdirSync(project);
  git(project, 'init', '-q', '-b', 'main');
  const log = path.join(dir, 'claude-calls.jsonl');
  const env = {
    ASK_REPO_REGISTRY: path.join(dir, 'config', 'registry.json'),
    ASK_REPO_CLAUDE: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: log,
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { dir, target, project, env, calls, sessions: path.join(project, 'artifacts', 'ask-repo', 'web') };
}

/** bin/ask-repo as the agent runs it in Bash. */
export function askRepo(args, { cwd, env = {} }) {
  const run = spawnSync('bash', [path.join(PLUGIN_ROOT, 'bin', 'ask-repo'), ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** `setup` plus the target registered as alias `web`. */
export function setupWithAlias(t) {
  const context = setup(t);
  const add = askRepo(['--add', 'web', context.target], { cwd: context.dir, env: context.env });
  if (add.status !== 0) throw new Error(`--add failed: ${add.stderr}`);
  return context;
}

/** The value after `flag` in an argv. */
export const argAfter = (argv, flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
