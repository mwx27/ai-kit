// How claude is found, started and read (core/claude.mjs).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FAKE_CLAUDE, argAfter, askRepo, setupWithAlias } from './helpers.mjs';

test('claude runs in the target repo, read-only, with the question on stdin and without CLAUDECODE', (t) => {
  const { project, target, env, calls } = setupWithAlias(t);
  const run = askRepo(['-a', 'web', 'q'], { cwd: project, env: { ...env, CLAUDECODE: '1' } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'answer to: q\n');

  const [call] = calls();
  assert.equal(call.cwd, target);
  assert.equal(call.stdin, 'q');
  assert.equal(call.claudecode, false);
  assert.equal(argAfter(call.argv, '--permission-mode'), 'dontAsk');
  assert.ok(call.argv.includes('--strict-mcp-config'));
  assert.deepEqual(call.argv.slice(call.argv.indexOf('--tools') + 1, call.argv.indexOf('--append-system-prompt-file')), ['Read', 'Grep', 'Glob']);
  assert.match(argAfter(call.argv, '--append-system-prompt-file'), /prompts[\\/]system\.md$/);
});

test('--git adds Bash for read-only git commands only, without git grep', (t) => {
  const { project, env, calls } = setupWithAlias(t);
  assert.equal(askRepo(['--git', '-a', 'web', 'q'], { cwd: project, env }).status, 0);
  const { argv } = calls()[0];
  assert.deepEqual(argv.slice(argv.indexOf('--tools') + 1, argv.indexOf('--allowedTools')), ['Read', 'Grep', 'Glob', 'Bash']);
  const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--append-system-prompt-file'));
  assert.ok(allowed.length > 0);
  for (const rule of allowed) assert.match(rule, /^Bash\(git [\w-]+:\*\)$/);
  assert.ok(!allowed.includes('Bash(git grep:*)'));
});

test('--model is passed on, a malformed one refused', (t) => {
  const { project, env, calls } = setupWithAlias(t);
  assert.equal(askRepo(['--model', 'haiku', '-a', 'web', 'q'], { cwd: project, env }).status, 0);
  assert.equal(argAfter(calls()[0].argv, '--model'), 'haiku');
  assert.equal(askRepo(['--model', 'a b', '-a', 'web', 'q'], { cwd: project, env }).status, 64);
});

test('a failing claude: its stderr and exit code come through', (t) => {
  const { project, sessions, env } = setupWithAlias(t);
  const run = askRepo(['-n', 'x', 'web', 'q'], { cwd: project, env: { ...env, FAKE_CLAUDE_MODE: 'exit' } });
  assert.equal(run.status, 3);
  assert.match(run.stderr, /exit code 3:\nfatal: something broke/);
  assert.equal(run.stdout, '');
  assert.ok(!existsSync(path.join(sessions, 'x.id')));
});

test('an error result and output that is not JSON are reported', (t) => {
  const { project, env } = setupWithAlias(t);
  const error = askRepo(['-a', 'web', 'q'], { cwd: project, env: { ...env, FAKE_CLAUDE_MODE: 'error' } });
  assert.equal(error.status, 1);
  assert.match(error.stderr, /claude failed:\nNot logged in/);

  const garbage = askRepo(['-a', 'web', 'q'], { cwd: project, env: { ...env, FAKE_CLAUDE_MODE: 'garbage' } });
  assert.equal(garbage.status, 1);
  assert.match(garbage.stderr, /this is not json/);
});

test('a question with quotes, % and shell characters arrives unchanged', (t) => {
  const { project, env, calls } = setupWithAlias(t);
  const question = `Why does "a & b" | c print %PATH% ^ !x! $HOME \`id\`?\nSecond line.`;
  assert.equal(askRepo(['-a', 'web', question], { cwd: project, env }).status, 0);
  assert.equal(calls()[0].stdin, question);
});

// The way a real install is found: a `claude` on PATH, in a folder with a space in its name. On
// Windows it is a .cmd, as an npm install makes, so this also covers the cmd.exe quoting.
test('claude is found on PATH when ASK_REPO_CLAUDE is not set', (t) => {
  const { dir, project, env, calls } = setupWithAlias(t);
  const bin = path.join(dir, 'with space');
  mkdirSync(bin);
  if (process.platform === 'win32') {
    writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${FAKE_CLAUDE}" %*\r\n`);
  } else {
    writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`);
    chmodSync(path.join(bin, 'claude'), 0o755);
  }
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const { ASK_REPO_CLAUDE, ...rest } = env;
  const run = askRepo(['-a', 'web', 'what & why "now"?'], {
    cwd: project,
    env: { ...rest, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey]}` },
  });
  assert.equal(run.status, 0, run.stderr);
  const [call] = calls();
  assert.equal(call.stdin, 'what & why "now"?');
  assert.ok(call.argv.includes('--strict-mcp-config'));
});

