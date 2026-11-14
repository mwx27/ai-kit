// The plugin's SessionStart notifier (hooks/notify.mjs → core/notify.mjs): what it tells the user
// about the repo's copy of the checks, against the plugin's version.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { COPY, PLUGIN_ROOT, PLUGIN_VERSION, cleanEnv, tmpRepo, writeFiles } from './helpers.mjs';

const CONFIG = '.claude/honest-docs.json';
const MANIFEST = `${COPY}/manifest.json`;

/** The plugin's hook as hooks/hooks.json runs it, with `cwd` in the payload. */
function notify(cwd, { projectDir = cwd } = {}) {
  const run = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'notify.mjs')], {
    cwd: projectDir,
    input: JSON.stringify({ session_id: 's', cwd, hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }),
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  return run.stdout === '' ? null : JSON.parse(run.stdout).systemMessage;
}

/** A repo with a config and, unless `manifest` is null, a manifest with that text. */
function project(t, manifest) {
  const files = { [CONFIG]: '{}\n' };
  if (manifest !== null) files[MANIFEST] = manifest;
  return tmpRepo(t, files);
}
const at = (version) => JSON.stringify({ version, files: {}, hooks: {} });

test('notify: no config, silent, whatever the copy', (t) => {
  const { root } = tmpRepo(t, { [MANIFEST]: at('0.0.1') });
  assert.equal(notify(root), null);
});

test('notify: a config and no copy, run /honest-docs:init', (t) => {
  const { root } = project(t, null);
  assert.equal(
    notify(root),
    'honest-docs: this repo uses honest-docs but its checks are not installed in the repo; run /honest-docs:init'
  );
});

test('notify: a copy older than the plugin, run /honest-docs:update', (t) => {
  const { root } = project(t, at('0.0.1'));
  assert.equal(notify(root), `honest-docs: this repo's checks are at 0.0.1, the plugin at ${PLUGIN_VERSION}; run /honest-docs:update`);
});

test('notify: a copy newer than the plugin, run claude plugin update', (t) => {
  const { root } = project(t, at('99.0.0'));
  assert.equal(notify(root), `honest-docs: this repo's checks are at 99.0.0, the plugin at ${PLUGIN_VERSION}; run claude plugin update`);
});

test('notify: the same version, silent', (t) => {
  const { root } = project(t, at(PLUGIN_VERSION));
  assert.equal(notify(root), null);
});

test('notify: a broken manifest or one with no version is named, exit 0', (t) => {
  const broken = project(t, '{ "version": ');
  assert.match(notify(broken.root), /^honest-docs: \.claude\/honest-docs\/manifest\.json cannot be read \(.+\)$/);
  const versionless = project(t, '{}');
  assert.equal(
    notify(versionless.root),
    `honest-docs: .claude/honest-docs/manifest.json: version null cannot be compared with the plugin's ${PLUGIN_VERSION}`
  );
});

test('notify: a broken config is named, exit 0', (t) => {
  const { root } = tmpRepo(t, { [CONFIG]: '{ nope' });
  assert.match(notify(root), /^honest-docs: \.claude\/honest-docs\.json: not valid JSON/);
});

test('notify: from a subfolder, the repo root is the one checked, not CLAUDE_PROJECT_DIR', (t) => {
  const { root } = project(t, at('0.0.1'));
  const other = tmpRepo(t);
  mkdirSync(path.join(root, 'src'));
  assert.match(notify(path.join(root, 'src'), { projectDir: other.root }), /run \/honest-docs:update$/);
  writeFiles(other.root, { [CONFIG]: '{}\n' });
  assert.match(notify(other.root, { projectDir: root }), /run \/honest-docs:init$/);
});
