// --list, --add and --remove (core/registry.mjs), and resolving an alias for a question.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { askRepo, setup, setupWithAlias } from './helpers.mjs';

test('--list without a registry says how to add an alias', (t) => {
  const { dir, env } = setup(t);
  const run = askRepo(['--list'], { cwd: dir, env });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /ask-repo --add <alias> <path>/);
});

test('--add resolves a relative path, --list shows it, --remove drops it', (t) => {
  const { dir, target, env } = setup(t);
  assert.equal(askRepo(['--add', 'web', 'target'], { cwd: dir, env }).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(env.ASK_REPO_REGISTRY, 'utf8')), { web: target });
  assert.equal(askRepo(['--list'], { cwd: dir, env }).stdout, `web  ${target}\n`);

  assert.equal(askRepo(['--remove', 'web'], { cwd: dir, env }).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(env.ASK_REPO_REGISTRY, 'utf8')), {});
});

test('--add refuses a missing folder, a taken alias and a bad alias', (t) => {
  const { dir, target, env } = setupWithAlias(t);
  const missing = askRepo(['--add', 'x', 'nope'], { cwd: dir, env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not a directory/);

  const taken = askRepo(['--add', 'web', target], { cwd: dir, env });
  assert.equal(taken.status, 1);
  assert.match(taken.stderr, /ask-repo --remove web/);

  assert.equal(askRepo(['--add', 'a/b', target], { cwd: dir, env }).status, 64);
});

test('an unknown alias names the known ones', (t) => {
  const { dir, env } = setupWithAlias(t);
  const run = askRepo(['mobile', 'question'], { cwd: dir, env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no alias mobile .*known: web/);
});

test('an alias whose folder is gone is reported', (t) => {
  const { dir, env } = setup(t);
  mkdirSync(path.dirname(env.ASK_REPO_REGISTRY), { recursive: true });
  writeFileSync(env.ASK_REPO_REGISTRY, JSON.stringify({ old: path.join(dir, 'gone') }));
  const run = askRepo(['old', 'question'], { cwd: dir, env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not a directory/);
});

test('a registry that is not a JSON object is reported, not a stack trace', (t) => {
  const { dir, env } = setup(t);
  mkdirSync(path.dirname(env.ASK_REPO_REGISTRY), { recursive: true });
  writeFileSync(env.ASK_REPO_REGISTRY, '[1]');
  const run = askRepo(['--list'], { cwd: dir, env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^ask-repo: .*JSON object/);
});
