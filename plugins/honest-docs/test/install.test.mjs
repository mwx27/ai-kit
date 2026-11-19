// /honest-docs:init and /honest-docs:update (scripts/install.mjs → core/install.mjs): the copy and
// its manifest, the settings.json merge, .prettierignore, the refusals, and the copy's hooks run from
// the entries the merge wrote. What core/init.mjs writes besides is in init.test.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../core/config.mjs';
import { copySources, fileHash, runInstall as installInProcess, unifiedDiff } from '../core/install.mjs';
import { copyHooks, mergeHooks, scriptOf } from '../core/settings-merge.mjs';
import {
  PLUGIN_ROOT,
  PLUGIN_VERSION,
  agentSession,
  cleanEnv,
  docsBaseline,
  fragment,
  git,
  readJson,
  readLines,
  runInstall,
  sessionPath,
  tmpRepo,
  writeDocsRule,
  writeFiles,
} from './helpers.mjs';

const COPY = '.claude/honest-docs';
const STATE = '.claude/honest-docs-state';
const SETTINGS = '.claude/settings.json';
const DATED = '**Last Updated:** 2026-01-15 10:30 CET';
const GOOD_DOC = `# Doc\n\n${DATED}\n\nText.\n`;
const PROBLEMS = (n) => `next: ${n} docs problem${n === 1 ? '' : 's'} in this repo (not blocking); propose fixes and wait for the user's consent`;

/** The template's settings.json before the move: foreign hooks and keys honest-docs must keep. */
const FOREIGN = {
  hooks: {
    PostToolUse: [{ matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/fingerprint-warning.mjs' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/fingerprint-baseline.mjs' }] }],
  },
  enabledPlugins: { 'honest-docs@mwx27-ai-kit': true },
  extraKnownMarketplaces: { 'mwx27-ai-kit': { source: { source: 'github', repo: 'mwx27/ai-kit' } } },
};

/** A 0.1.x project: the rule, the 0.1.0 fragments, a config, foreign settings, a .prettierignore. */
function legacyProject(t, files = {}) {
  const project = tmpRepo(t, {
    ...docsBaseline(),
    '.claude/honest-docs.json': '{ "docsDir": "_docs" }\n',
    [SETTINGS]: `${JSON.stringify(FOREIGN, null, 2)}\n`,
    '.prettierignore': 'node_modules\n',
    '_docs/doc.md': GOOD_DOC,
    ...files,
  });
  writeDocsRule(project.root);
  git(project.root, 'add', '-A');
  git(project.root, 'commit', '-q', '-m', 'rule');
  return project;
}

const read = (root, file) => readFileSync(path.join(root, file), 'utf8');
/** Every path git does not track, ignored ones included, and every modified one: what a run wrote. */
const treeState = (root) => git(root, 'status', '--porcelain', '--ignored', '--untracked-files=all');
const commitAll = (root) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'install');
};

/**
 * A plugin folder at `version` beside the tests' tmp repo: this plugin's code, with its own
 * plugin.json and, when given, CHANGELOG.md.
 */
function fakePlugin(dir, version, changelog) {
  const root = path.join(dir, `plugin-${version}`);
  for (const part of ['core', 'hooks', 'scripts', 'templates', 'CHANGELOG.md'])
    cpSync(path.join(PLUGIN_ROOT, part), path.join(root, part), { recursive: true });
  writeFiles(root, { '.claude-plugin/plugin.json': JSON.stringify({ name: 'honest-docs', version }) });
  if (changelog) writeFiles(root, { 'CHANGELOG.md': changelog });
  return root;
}

/**
 * Runs the hook `hook` the way Claude Code runs the project's settings.json: the handler in the
 * event's groups whose matcher takes the tool, ${CLAUDE_PROJECT_DIR} substituted. With no such
 * handler — the hooks are not installed yet — nothing runs, as in a session that has none.
 */
function runFromSettings(root, hook, payload, env = {}) {
  const file = path.join(root, SETTINGS);
  const groups = existsSync(file) ? (readJson(file).hooks?.[payload.hook_event_name] ?? []) : [];
  const handler = groups
    .filter((g) => !g.matcher || new RegExp(`^(?:${g.matcher})$`).test(payload.tool_name ?? ''))
    .flatMap((g) => g.hooks)
    .find((h) => scriptOf(h) === `hooks/${hook}.mjs`);
  if (!handler) return { status: 0, stdout: '', stderr: '' };
  const args = handler.args.map((arg) => arg.replaceAll('${CLAUDE_PROJECT_DIR}', root));
  const run = spawnSync(handler.command === 'node' ? process.execPath : handler.command, args, {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** A session whose hooks are whatever settings.json holds when each one fires; `stop()` ends a turn. */
function settingsSession(root, session, env = {}) {
  const agent = agentSession(root, session, { run: (hook, payload) => runFromSettings(root, hook, payload, env) });
  const stop = () =>
    runFromSettings(root, 'stop-gate', { session_id: session, cwd: root, hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false }, env);
  const gateLog = () => readLines(path.join(root, `.claude/honest-docs-state/logs/guard-gate-${session}.log`));
  return { ...agent, stop, gateLog };
}

test('the plugin hooks.json holds only the notifier, and the hooks install merges are the copy machinery', () => {
  assert.deepEqual(readJson(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json')), {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/notify.mjs'], timeout: 10 }] }],
    },
  });
  const hook = (script, timeout) => ({ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/.claude/honest-docs/hooks/${script}`], timeout });
  assert.deepEqual(copyHooks(), {
    SessionStart: [{ hooks: [hook('session-start.mjs', 15)] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [hook('pre-tool.mjs', 10)] }],
    PostToolUse: [
      { matcher: 'Edit|Write|NotebookEdit|Bash', hooks: [hook('post-tool.mjs', 10)] },
      { matcher: 'Edit|Write|Skill|Read', hooks: [hook('instructions-log.mjs', 5)] },
    ],
    PostToolUseFailure: [{ matcher: 'Bash', hooks: [hook('post-tool.mjs', 10)] }],
    Stop: [{ hooks: [hook('stop-gate.mjs', 180)] }],
    InstructionsLoaded: [{ hooks: [hook('instructions-log.mjs', 5)] }],
    UserPromptExpansion: [{ hooks: [hook('instructions-log.mjs', 5)] }],
  });
});

test('init on a 0.1.x project: copies the files, a manifest whose hashes match, merges the hooks, installed X', (t) => {
  const { root } = legacyProject(t);
  const run = runInstall(root, 'init');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^honest-docs-init: installed ${PLUGIN_VERSION.replaceAll('.', '\\.')}$`, 'm'));

  const sources = copySources();
  const manifest = readJson(path.join(root, COPY, 'manifest.json'));
  assert.equal(manifest.version, PLUGIN_VERSION);
  assert.deepEqual(Object.keys(manifest.files).sort(), [...sources.keys()].sort());
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(fileHash(read(root, `${COPY}/${file}`)), hash, file);
  assert.ok(sources.has('core/gate.mjs') && sources.has('templates/docs.md') && sources.has('scripts/docs-grep.mjs'));
  assert.ok(!sources.has('hooks/hooks.json') && !sources.has('scripts/install.mjs') && !sources.has('scripts/context-budget.mjs'));
  assert.deepEqual(manifest.hooks, copyHooks());

  // Foreign hooks and keys in place and in order; ours appended.
  const settings = readJson(path.join(root, SETTINGS));
  assert.deepEqual(Object.keys(settings), ['hooks', 'enabledPlugins', 'extraKnownMarketplaces']);
  assert.deepEqual(settings.enabledPlugins, FOREIGN.enabledPlugins);
  assert.deepEqual(settings.extraKnownMarketplaces, FOREIGN.extraKnownMarketplaces);
  assert.deepEqual(Object.keys(settings.hooks).slice(0, 2), ['PostToolUse', 'SessionStart']);
  assert.deepEqual(settings.hooks.PostToolUse[0], FOREIGN.hooks.PostToolUse[0]);
  assert.deepEqual(settings.hooks.SessionStart[0], FOREIGN.hooks.SessionStart[0]);
  assert.deepEqual(mergeHooks(FOREIGN, { previous: null, next: copyHooks(), version: PLUGIN_VERSION }).settings, settings);

  assert.equal(read(root, '.prettierignore'), `node_modules\n${COPY}/\n${STATE}/\n`);
  assert.equal(read(root, '.claude/honest-docs.json'), '{ "docsDir": "_docs" }\n');
  assert.match(run.stdout, /^next: format the files written above the way the project formats them: .*\.claude\/settings\.json, \.prettierignore$/m);
  assert.match(run.stdout, /^next: if ESLint or tsc check \.claude\/, exclude \.claude\/honest-docs\/ there$/m);
  assert.doesNotMatch(run.stdout, /docs problem/);
});

test('the merged entries point at files in the copy, and the copy Stop hook run from one gates the repo', (t) => {
  const { root } = legacyProject(t);
  assert.equal(runInstall(root, 'init').status, 0);
  commitAll(root);
  for (const [event, groups] of Object.entries(readJson(path.join(root, SETTINGS)).hooks))
    for (const handler of groups.flatMap((g) => g.hooks).filter(scriptOf))
      for (const arg of handler.args) assert.ok(existsSync(arg.replaceAll('${CLAUDE_PROJECT_DIR}', root)), `${event}: ${arg}`);

  const session = settingsSession(root, 'e2e');
  assert.equal(session.start().status, 0);
  session.write('_docs/doc.md', `${GOOD_DOC}See [gone](gone.md).\n`);
  const stop = session.stop();
  assert.equal(stop.status, 2, stop.stdout);
  assert.match(stop.stderr, /_docs\/doc\.md:\d+ {2}no such file: gone\.md/);
  assert.match(stop.stderr, /To reproduce: node \.claude\/honest-docs\/scripts\/docs-check\.mjs/);
});

test('docs-check run from the copy passes the init category after install', (t) => {
  const { root } = legacyProject(t);
  assert.equal(runInstall(root, 'init').status, 0);
  const run = spawnSync(process.execPath, [path.join(root, COPY, 'scripts', 'docs-check.mjs'), '--json'], { cwd: root, encoding: 'utf8', env: cleanEnv() });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).problems.filter((p) => p.check === 'init'), []);
});

test('init ends with the count of docs problems the new copy reports', (t) => {
  const { root } = legacyProject(t, { '_docs/doc.md': `${GOOD_DOC}[a](a.md) [b](b.md)\n` });
  const run = runInstall(root, 'init');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trimEnd().split('\n').at(-1), PROBLEMS(2));
});

// Refusals: exit 1, nothing written.

const refused = (root, mode, pattern, args) => {
  const before = treeState(root);
  const run = runInstall(root, mode, { args });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, pattern);
  assert.match(run.stderr, new RegExp(`honest-docs-${mode}: nothing written\\n$`));
  assert.equal(treeState(root), before);
  return run;
};

test('init refuses where a manifest exists', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  commitAll(root);
  refused(root, 'init', new RegExp(`^honest-docs-init: already installed \\(${PLUGIN_VERSION.replaceAll('.', '\\.')}\\): run /honest-docs:update\\n`));
});

test('update refuses where nothing is installed', (t) => {
  const { root } = legacyProject(t);
  refused(root, 'update', /^honest-docs-update: not installed here: run \/honest-docs:init\n/);
});

test('update refuses a copy newer than the plugin', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  const manifest = path.join(root, COPY, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ ...readJson(manifest), version: '9.0.0' }));
  commitAll(root);
  refused(root, 'update', new RegExp(`^honest-docs-update: this repo's copy is 9\\.0\\.0, the plugin is ${PLUGIN_VERSION.replaceAll('.', '\\.')}: run claude plugin update\\n`));
});

test('a settings.json that is not a JSON object, or not JSON: refused', (t) => {
  for (const [text, pattern] of [
    ['[]\n', /^honest-docs-init: \.claude\/settings\.json is not a JSON object\n/],
    ['{ "hooks": \n', /^honest-docs-init: \.claude\/settings\.json is not valid JSON \(.+\)\n/],
    ['{ "hooks": [] }\n', /^honest-docs-init: \.claude\/settings\.json: "hooks" is not an object\n/],
  ]) {
    const { root } = legacyProject(t, { [SETTINGS]: text });
    refused(root, 'init', pattern);
  }
});

test('a fragment found twice: refused before the copy or settings.json are written', (t) => {
  const { root } = legacyProject(t, { 'CLAUDE.md': `${docsBaseline()['CLAUDE.md']}\n${fragment('read-line')}\n` });
  refused(root, 'init', /^honest-docs-init: read-line: found 2 times in CLAUDE\.md/);
});

test('a broken config: exit 2, nothing written', (t) => {
  const { root } = legacyProject(t);
  writeFiles(root, { '.claude/honest-docs.json': '{ nope' });
  const before = treeState(root);
  const run = runInstall(root, 'init');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^honest-docs-init: \.claude\/honest-docs\.json: not valid JSON/);
  assert.equal(treeState(root), before);
});

// The copy: hand edits, line endings, repair, a crash.

test('a copied file changed by hand: update exits 1 with a diff, writes nothing; --force overwrites it', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  const file = path.join(root, COPY, 'core', 'gate.mjs');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}// a local tweak\n`);
  commitAll(root);

  const run = refused(root, 'update', /^honest-docs-update: 1 file in \.claude\/honest-docs\/ changed by hand since honest-docs wrote it; rerun with --force to overwrite\n/);
  assert.match(run.stderr, /^--- \.claude\/honest-docs\/core\/gate\.mjs \(yours\)\n\+\+\+ \.claude\/honest-docs\/core\/gate\.mjs \(\d+\.\d+\.\d+\)\n@@ /m);
  assert.match(run.stderr, /^-\/\/ a local tweak$/m);

  const forced = runInstall(root, 'update', { args: ['--force'] });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('a file added by hand to the copy counts as changed by hand', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  writeFiles(root, { [`${COPY}/core/mine.mjs`]: 'export {};\n' });
  commitAll(root);
  const run = refused(root, 'update', /1 file in \.claude\/honest-docs\/ changed by hand/);
  assert.match(run.stderr, /^\+\+\+ \/dev\/null$/m);
});

test('a copy checked out with CRLF matches its manifest: no hand edit reported', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  for (const file of Object.keys(readJson(path.join(root, COPY, 'manifest.json')).files)) {
    const full = path.join(root, COPY, file);
    writeFileSync(full, readFileSync(full, 'utf8').replace(/\n/g, '\r\n'));
  }
  const run = runInstall(root, 'update');
  assert.equal(run.status, 0, run.stderr);
});

test('update at the same version repairs: a deleted copied file comes back', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  rmSync(path.join(root, COPY, 'core', 'gate.mjs'));
  const run = runInstall(root, 'update');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^honest-docs-update: wrote \\.claude/honest-docs/ \\(1 file changed\\)$`, 'm'));
  assert.match(run.stdout, new RegExp(`^honest-docs-update: updated ${PLUGIN_VERSION.replaceAll('.', '\\.')} → ${PLUGIN_VERSION.replaceAll('.', '\\.')}$`, 'm'));
  assert.ok(existsSync(path.join(root, COPY, 'core', 'gate.mjs')));
});

test('a crash between staging and the swap leaves the old copy whole and no staging folder', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  const manifest = path.join(root, COPY, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ ...readJson(manifest), version: '0.0.1' }));
  const before = readFileSync(manifest, 'utf8');
  assert.throws(
    () =>
      installInProcess(root, loadConfig(root), {
        mode: 'update',
        beforeSwap: () => {
          throw new Error('simulated crash');
        },
      }),
    /simulated crash/
  );
  assert.equal(readFileSync(manifest, 'utf8'), before);
  assert.ok(existsSync(path.join(root, COPY, 'core', 'gate.mjs')));
  assert.deepEqual(readdirSync(path.join(root, '.claude')).filter((f) => f.startsWith('honest-docs.')), ['honest-docs.json']);
});

test('update to a new version prints updated X → Y and only the CHANGELOG sections in range', (t) => {
  const { root, dir } = legacyProject(t);
  const changelog = [
    '# Changelog\n\n---\n',
    '## [0.2.2] — later\n\n- Not yet.\n\n---\n',
    '## [0.2.1] — 2026-12-01\n\n### Fixed\n\n- The second thing.\n\n---\n',
    '## [0.2.0] — 2026-11-20\n\n- The first thing.\n\n---\n',
    '## [0.1.8] — 2026-11-04\n\n- Before.\n',
  ].join('\n');
  assert.equal(runInstall(root, 'init', { pluginRoot: fakePlugin(dir, '0.2.0', changelog) }).status, 0);
  const run = runInstall(root, 'update', { pluginRoot: fakePlugin(dir, '0.2.1', changelog) });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^honest-docs-update: updated 0\.2\.0 → 0\.2\.1\n\n## \[0\.2\.1\] — 2026-12-01\n\n### Fixed\n\n- The second thing\.\n\n/m);
  assert.doesNotMatch(run.stdout, /\[0\.2\.0\]|\[0\.2\.2\]|\[0\.1\.8\]/);
  assert.equal(readJson(path.join(root, COPY, 'manifest.json')).version, '0.2.1');
});

test('the 0.2.0 docs-policy fragment replaces 0.1.0 and names the copy docs-grep', (t) => {
  const claudeMd = docsBaseline()['CLAUDE.md'].replace(fragment('docs-policy'), fragment('docs-policy', '0.1.0'));
  const { root, dir } = legacyProject(t, { 'CLAUDE.md': claudeMd });
  const run = runInstall(root, 'init', { pluginRoot: fakePlugin(dir, '0.2.0') });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^honest-docs-init: docs-policy: 0\.1\.0 → 0\.2\.0$/m);
  assert.match(read(root, 'CLAUDE.md'), /`node \.claude\/honest-docs\/scripts\/docs-grep\.mjs <symbol>…`/);
  assert.match(read(root, '.claude/rules/docs.md'), /`node \.claude\/honest-docs\/scripts\/docs-check\.mjs`/);
});

// settings.json

/** The copy's handler for `script` on `event` in settings.json, found by `script`. */
const handlerIn = (settings, event, script) =>
  settings.hooks[event].flatMap((g) => g.hooks).find((h) => scriptOf(h) === `hooks/${script}.mjs`);

test('a hook edited by hand is kept, with a next: line showing both, and not overwritten', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  const file = path.join(root, SETTINGS);
  const settings = readJson(file);
  handlerIn(settings, 'Stop', 'stop-gate').timeout = 240;
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  const before = readFileSync(file, 'utf8');

  const run = runInstall(root, 'update');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.match(
    run.stdout,
    /^next: \.claude\/settings\.json: Stop hook hooks\/stop-gate\.mjs was edited by hand, so honest-docs \S+ left it as it is; tell the user it differs: found \{.*"timeout":240.*\}, honest-docs writes \{.*"timeout":180.*\}$/m
  );
});

test('a hook removed by hand is not added back, and a next: line says it is off', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  const file = path.join(root, SETTINGS);
  const settings = readJson(file);
  delete settings.hooks.PreToolUse;
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);

  const run = runInstall(root, 'update');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readJson(file).hooks.PreToolUse, undefined);
  assert.match(run.stdout, /^next: \.claude\/settings\.json: PreToolUse \(Bash\) hook hooks\/pre-tool\.mjs was removed by hand, so honest-docs \S+ left it out; tell the user it is off: /m);
});

test('a settings.json Prettier reformatted, content unchanged, is not rewritten', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  const file = path.join(root, SETTINGS);
  // Prettier's layout: short arrays on one line, unlike JSON.stringify's.
  const formatted = readFileSync(file, 'utf8').replace(/\[\n\s+("[^"\n]+")\n\s+\]/g, '[$1]');
  assert.notEqual(formatted, readFileSync(file, 'utf8'));
  writeFileSync(file, formatted);
  const run = runInstall(root, 'update');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(file, 'utf8'), formatted);
  assert.doesNotMatch(run.stdout, /wrote \.claude\/settings\.json/);
});

test('an update that drops a hook removes it where it is as written, and keeps it where edited', () => {
  const next = copyHooks();
  const previous = structuredClone(next);
  previous.Notification = [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/honest-docs/hooks/gone.mjs'] }] }];
  const settings = { hooks: structuredClone(previous) };
  const dropped = mergeHooks(settings, { previous, next, version: '0.2.1' });
  assert.equal(dropped.settings.hooks.Notification, undefined);
  assert.deepEqual(dropped.nexts, []);

  settings.hooks.Notification[0].hooks[0].timeout = 3;
  const kept = mergeHooks(settings, { previous, next, version: '0.2.1' });
  assert.deepEqual(kept.settings.hooks.Notification, settings.hooks.Notification);
  assert.match(kept.nexts[0], /Notification hook hooks\/gone\.mjs was edited by hand, .* honest-docs writes nothing$/);
});

test('a string-form command naming $CLAUDE_PROJECT_DIR/.claude/honest-docs/ is recognised as ours', () => {
  const handler = { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/honest-docs/hooks/stop-gate.mjs"', timeout: 180 };
  assert.equal(scriptOf(handler), 'hooks/stop-gate.mjs');
  assert.equal(scriptOf({ type: 'command', command: 'node .claude/hooks/fingerprint-warning.mjs' }), null);
  // On init nothing is recorded, so it counts as edited by hand: kept, not doubled.
  const { settings, nexts } = mergeHooks({ hooks: { Stop: [{ hooks: [handler] }] } }, { previous: null, next: copyHooks(), version: '0.2.0' });
  assert.deepEqual(settings.hooks.Stop, [{ hooks: [handler] }]);
  assert.match(nexts.join('\n'), /^\.claude\/settings\.json: Stop hook hooks\/stop-gate\.mjs was edited by hand/m);
});

test('a diff shows the lines removed and added with context', () => {
  const a = 'one\ntwo\nthree\nfour\n';
  const b = 'one\n2\nthree\nfour\nfive\n';
  assert.equal(unifiedDiff(a, b, 'a', 'b'), '--- a\n+++ b\n@@ -1,4 +1,5 @@\n one\n-two\n+2\n three\n four\n+five\n');
  assert.equal(unifiedDiff(a, a, 'a', 'b'), '');
});

// .prettierignore

test('.prettierignore: appended once; one with .claude/ untouched; none, not created and a next: line', (t) => {
  const { root } = legacyProject(t, { '.prettierignore': 'node_modules' });
  runInstall(root, 'init');
  assert.equal(read(root, '.prettierignore'), `node_modules\n${COPY}/\n${STATE}/\n`);
  const second = runInstall(root, 'update');
  assert.doesNotMatch(second.stdout, /prettierignore/);
  assert.equal(read(root, '.prettierignore'), `node_modules\n${COPY}/\n${STATE}/\n`);

  // One that already covers the copy gets the state folder alone.
  const copyOnly = legacyProject(t, { '.prettierignore': `${COPY}/\n` });
  runInstall(copyOnly.root, 'init');
  assert.equal(read(copyOnly.root, '.prettierignore'), `${COPY}/\n${STATE}/\n`);

  // State and logs moved out of the state folder: only the copy is listed.
  const moved = legacyProject(t, { '.prettierignore': '', '.claude/honest-docs.json': JSON.stringify({ stateDir: 'tmp/state', logDir: 'tmp/logs' }) });
  runInstall(moved.root, 'init');
  assert.equal(read(moved.root, '.prettierignore'), `${COPY}/\n`);

  const covered = legacyProject(t, { '.prettierignore': '/.claude/\n' });
  const run = runInstall(covered.root, 'init');
  assert.equal(read(covered.root, '.prettierignore'), '/.claude/\n');
  assert.doesNotMatch(run.stdout, /Prettier/);

  const none = legacyProject(t);
  rmSync(path.join(none.root, '.prettierignore'));
  const bare = runInstall(none.root, 'init');
  assert.equal(existsSync(path.join(none.root, '.prettierignore')), false);
  assert.match(bare.stdout, /^next: Prettier: add \.claude\/honest-docs\/ and \.claude\/honest-docs-state\/ to your ignore file$/m);
});

// Where the hooks write

test('init makes the state folder with its .gitignore, so git status stays clean from the first run', (t) => {
  const { root } = legacyProject(t);
  runInstall(root, 'init');
  assert.equal(read(root, `${STATE}/.gitignore`), '*\n');
  assert.doesNotMatch(git(root, 'status', '--porcelain', '--untracked-files=all'), /honest-docs-state/);
});

test('warnings: files git tracks in the state folder, and a moved stateDir or logDir git does not ignore', (t) => {
  const tracked = legacyProject(t, { [`${STATE}/logs/old.log`]: 'x\n' });
  assert.match(
    runInstall(tracked.root, 'init').stderr,
    /^warning: git tracks 1 file under \.claude\/honest-docs-state\/, where the hooks keep session state and logs; remove it from the repo$/m
  );

  const config = JSON.stringify({ stateDir: 'tmp/state', logDir: 'logs' });
  const moved = legacyProject(t, { '.claude/honest-docs.json': config, '.gitignore': 'logs/\n' });
  const run = runInstall(moved.root, 'init');
  assert.match(run.stderr, /^warning: git does not ignore tmp\/state\/, where the config keeps the hooks' state or logs; add it to \.gitignore, or they will show up in git status$/m);
  assert.doesNotMatch(run.stderr, /does not ignore logs\//);
  assert.equal(existsSync(path.join(moved.root, STATE)), false);
});

test('update names the state and logs of earlier versions, only those of honest-docs, and deletes nothing', (t) => {
  const { root } = legacyProject(t, { '.gitignore': 'artifacts/\n' });
  runInstall(root, 'init');
  commitAll(root);
  const earlier = {
    'artifacts/claude-hooks/honest-docs/s/state.json': '{}\n',
    'artifacts/claude-hooks/fingerprint-s.json': '{}\n',
    'artifacts/logs/events.jsonl': '{}\n',
    'artifacts/logs/guard-gate-a.log': 'x\n',
    'artifacts/logs/guard-gate-b.log': 'x\n',
    'artifacts/logs/guard-sh.log': 'x\n',
  };
  writeFiles(root, earlier);
  const run = runInstall(root, 'update');
  assert.match(
    run.stderr,
    /^warning: honest-docs no longer reads the state and logs of earlier versions; delete them when you no longer need them: artifacts\/claude-hooks\/honest-docs\/, artifacts\/logs\/events\.jsonl, artifacts\/logs\/guard-gate-\*\.log \(2 files\)$/m
  );
  for (const file of Object.keys(earlier)) assert.ok(existsSync(path.join(root, file)), file);
});

// In a session: K8 and an update under the copy's own hooks.

test('K8: install from Bash in a session without hooks, then a formatting Bash: the stop does not block, the next broken link does', (t) => {
  const { root } = tmpRepo(t, {
    'CLAUDE.md': '# Project\n',
    'package.json': '{ "name": "fixture" }\n',
    '_docs/doc.md': `# Doc\n\n${DATED}\n\n[a](a.md) [b](b.md) [c](c.md)\n`,
  });
  // Hooks absent at session start: no SessionStart, and the install's own Bash has no Pre.
  const session = settingsSession(root, 'k8');
  const install = session.bash(() => {
    const run = runInstall(root, 'init');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`${PROBLEMS(3).replace(/[.()']/g, '\\$&')}\\n$`));
  });
  assert.equal(install.status, 0, install.stderr);
  // The agent formats CLAUDE.md from a second Bash, with the hooks now in place.
  session.bash(() => {
    const text = read(root, 'CLAUDE.md');
    writeFileSync(path.join(root, 'CLAUDE.md'), text.replace(fragment('docs-policy'), fragment('docs-policy').split(/\s+/).join(' ')));
  });

  const first = session.stop();
  assert.equal(first.status, 0, first.stderr);
  assert.match(session.gateLog()[0], / {2}pass {2}docs-check-only start-set-at-stop$/);
  assert.equal(readJson(sessionPath(root, 'k8', 'start.json')).problems.reduce((n, p) => n + p.count, 0), 3);

  session.write('_docs/doc.md', `${read(root, '_docs/doc.md')}\nSee [lost](lost.md).\n`);
  const second = session.stop();
  assert.equal(second.status, 2);
  assert.match(second.stderr, /_docs\/doc\.md:\d+ {2}no such file: lost\.md/);
  assert.doesNotMatch(second.stderr, /no such file: a\.md/);
});

test('update in a session running the copy hooks: the stop renews the start set, does not block on the docs, guards only attributed files', (t) => {
  const { dir, root } = legacyProject(t, { 'src/a.ts': 'export const a = 1;\n' });
  const record = path.join(dir, 'guard-calls.jsonl');
  const guard = path.join(dir, 'guard.mjs');
  writeFileSync(guard, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  writeFiles(root, { '.claude/honest-docs.json': JSON.stringify({ guard: { command: ['node', guard] } }) });
  assert.equal(runInstall(root, 'init', { pluginRoot: fakePlugin(dir, '0.2.0') }).status, 0);
  commitAll(root);

  const session = settingsSession(root, 'upd');
  assert.equal(session.start().status, 0);
  assert.equal(readJson(sessionPath(root, 'upd', 'start.json')).version, '0.2.0');
  session.write('src/a.ts', 'export const a = 2;\n');
  writeFiles(root, { 'src/editor.ts': 'export const e = 1;\n' }); // the user's editor: not the session's
  session.bash(() => assert.equal(runInstall(root, 'update', { pluginRoot: fakePlugin(dir, '0.2.1') }).status, 0));
  session.write('_docs/doc.md', `${GOOD_DOC}See [gone](gone.md).\n`);

  const stop = session.stop();
  assert.equal(stop.status, 0, stop.stderr);
  assert.match(session.gateLog()[0], / {2}pass {2}start-set-renewed$/);
  assert.equal(readJson(sessionPath(root, 'upd', 'start.json')).version, '0.2.1');
  const [args] = readLines(record).map((line) => JSON.parse(line));
  assert.deepEqual(args.slice(1).sort(), ['.claude/rules/docs.md', '_docs/doc.md', 'src/a.ts']);
  assert.equal(args[0], '--changed');
});
