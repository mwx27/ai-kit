// Stop gate: blocks the end of a turn that left the working tree failing docs-check or the
// project's guard.
//
// It replaces the instruction telling the agent to remember to run the checks — a rule that costs
// context in every session and is forgotten in the one where it matters. Nothing is reimplemented
// here: it runs the plugin's scripts/docs-check.mjs, then the project's guard as configured in
// `guard.command` (core/config.mjs), with HONEST_DOCS_SCRIPTS pointing at the plugin's scripts/.
//
// docs-check runs first, on every stop with something to check, whatever changed: it scans the
// whole docs tree, and a code change can break a doc as surely as a doc edit. A failure there blocks
// as check `docs` and the guard does not run. Without `guard.command`, a passing docs-check passes.
//
// Guard contract: `<command…> --changed <files…>`, exit 0 on success. On failure it may print
// `GUARD_FAIL check=<name>` to name the check (default `guard`). Its output for one failure must be
// the same run to run, apart from what normalize() strips. It need not run docs-check; one that
// still does runs it a second time, which costs time and nothing else.
//
// What it runs on: everything git reports as changed, minus what already passed in this exact
// content (core/session-state.mjs). It deliberately does not read a record of the agent's own
// Edit and Write calls — the agent also edits through Bash, so a `sed -i` turn slipped through in
// silence. Silence is reserved for a tree with nothing left to check.
//
// It also writes to the tree, and only to docs: before the checks run, each doc it is about to check
// that carries a Last Updated line gets it restamped (core/last-updated.mjs).
//
// Loop protection is deliberately not "exit 0 on stop_hook_active" — that disarms the gate the
// first time the agent stops twice, which is exactly when it is doing the work. Instead the same
// failure (same files, same output) may block twice; the third identical one is let through and the
// files are recorded in `gaveUp` at their current content. The concession is per file per content:
// edit one of them again and its hash no longer matches, so the gate picks it back up.
//
// Every invocation appends one line to <logDir>/guard-gate-<session>.log:
//   <ISO>  ran|skipped  changed=<n> checked=<n>  ms=<n>  pass|fail|giveup|error|-  [reason]
// so the question "what does this gate actually cost per turn" is answered by the log, not by
// an estimate. `ran` means docs-check was started. A pass with no guard configured carries the
// reason `docs-check-only`. The same outcome goes to the shared event log (core/log.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { changedFiles } from './changed-files.mjs';
import { loadConfig, ownDirs } from './config.mjs';
import { stampLastUpdated } from './last-updated.mjs';
import { PLUGIN_ROOT, logEvent } from './log.mjs';
import { sessionKey, sessionStore } from './session-state.mjs';

/** Identical failures tolerated before the gate concedes and lets the stop through. */
const MAX_REPEATS = 3;
// docs-check and the guard run one after the other, so the two together must fit the Stop hook's
// timeout (180 s in hooks/hooks.json), or Claude Code kills the gate before it can answer.
const DOCS_CHECK_TIMEOUT_MS = 20_000;
const GUARD_TIMEOUT_MS = 150_000;
const DETAIL_LINES = 12;
const LISTED_FILES = 10;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** What the agent runs in Bash to reproduce a docs failure: the plugin's bin/ is on its PATH. */
const DOCS_CHECK_COMMAND = 'honest-docs-check';

/** Strips colour, per-run timings and log timestamps, so two identical failures hash identically. */
function normalize(output) {
  return output
    .replace(ANSI, '')
    .replace(/\(\d+s\)/g, '')
    .replace(/\d{8}_\d{6}/g, '')
    .trim();
}

/** `GUARD_FAIL check=eslint files=2` — the line the guard prints before it stops. */
function failedCheck(output) {
  return output.match(/GUARD_FAIL check=(\S+)/)?.[1] ?? 'guard';
}

function errorDetails(output) {
  const lines = normalize(output).split('\n');
  const start = lines.findIndex((line) => line.includes('=== Error details ==='));
  const body = start === -1 ? lines : lines.slice(start + 1);
  // GUARD_FAIL ends the details: what follows is the file list, which the message already carries.
  const end = body.findIndex((line) => line.startsWith('GUARD_FAIL'));
  return (end === -1 ? body : body.slice(0, end))
    .filter((line) => line.trim() !== '')
    .slice(0, DETAIL_LINES)
    .map((line) => `    ${line}`)
    .join('\n');
}

/** 1 plik / 2 pliki / 5 plików — the message is read by a person, so it agrees with the number. */
function plural(count) {
  if (count === 1) return 'plik';
  const rest = count % 100;
  return rest > 11 && rest < 15 ? 'plików' : [2, 3, 4].includes(count % 10) ? 'pliki' : 'plików';
}

function fileList(files) {
  const shown = files.slice(0, LISTED_FILES).map((file) => `  ${file}`);
  if (files.length > LISTED_FILES) shown.push(`  ... and ${files.length - LISTED_FILES} more`);
  return shown.join('\n');
}

/** Hook input → { stdout, stderr, exitCode }. Exit 2 with stderr blocks the stop. */
export function gate(input) {
  const start = Date.now();
  let root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  let session = 'unknown';
  let logDir = null;

  /** One line per invocation. `ran` means docs-check was started; `skipped` means nothing was. */
  function audit(kind, changed, checked, outcome, reason = '', check = undefined) {
    const ms = Date.now() - start;
    logEvent(root, 'gate', { kind, outcome, reason: reason && reason !== check ? reason : undefined, check, changed, checked, ms });
    if (!logDir) return;
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        path.join(logDir, `guard-gate-${session}.log`),
        `${new Date().toISOString()}  ${kind}  changed=${changed} checked=${checked}  ms=${ms}  ${outcome}${reason ? `  ${reason}` : ''}\n`
      );
    } catch {
      // A gate that fails over its own log is worse than a gate with no log.
    }
  }

  try {
    const config = loadConfig(root);
    logDir = path.join(root, config.logDir);

    if (!input) {
      audit('skipped', 0, 0, '-', 'no-input');
      return { exitCode: 0 };
    }

    session = sessionKey(input.session_id);

    if (input.permission_mode === 'plan') {
      audit('skipped', 0, 0, '-', 'plan-mode');
      return { exitCode: 0 };
    }

    const excluded = ownDirs(config);
    const changed = changedFiles(root, excluded);
    if (changed === null) {
      audit('skipped', 0, 0, '-', 'no-git'); // Nothing is known about the tree, so nothing is blocked.
      return { exitCode: 0 };
    }

    const store = sessionStore(root, config, session);
    const state = store.read() ?? { verified: {}, gaveUp: {} };
    let toCheck = changed.filter(({ path: file, hash }) => state.verified[file] !== hash && state.gaveUp[file] !== hash);
    const files = toCheck.map(({ path: file }) => file);

    if (files.length === 0) {
      audit('skipped', changed.length, 0, '-', 'nothing-new');
      return { exitCode: 0 };
    }

    // Stamped before the checks run, so formatters and docs-check see the final content — and
    // rehashed, so `verified` records the stamped file and the next stop does not take it for a new edit.
    if (stampLastUpdated(root, files, config.timeZone).length > 0) {
      const fresh = new Map((changedFiles(root, excluded) ?? []).map((entry) => [entry.path, entry.hash]));
      toCheck = toCheck.map((entry) => ({ ...entry, hash: fresh.get(entry.path) ?? entry.hash }));
    }

    const scripts = path.join(process.env.CLAUDE_PLUGIN_ROOT || PLUGIN_ROOT, 'scripts');
    const command = config.guard.command;
    const hasGuard = Array.isArray(command) && command.length > 0;
    const guardCommand = hasGuard ? command.join(' ') : '';
    // docs-check first: a guard that fails on code would otherwise hide a broken doc until it passes.
    const steps = [
      {
        name: 'docs-check',
        check: 'docs',
        argv: [process.execPath, path.join(scripts, 'docs-check.mjs')],
        timeout: DOCS_CHECK_TIMEOUT_MS,
      },
      ...(hasGuard
        ? [{ name: 'guard --changed', check: null, argv: [...command, '--changed', ...files], timeout: GUARD_TIMEOUT_MS }]
        : []),
    ];

    const checksStart = Date.now();
    const ran = [];
    const ranMessage = () =>
      `${ran.join(', ')}: ${files.length} ${plural(files.length)}, ${((Date.now() - checksStart) / 1000).toFixed(1)}s`;

    /** A failed check: blocks the stop, or lets it through on the third identical failure. */
    function block(check, output, message) {
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([files, normalize(output)]))
        .digest('hex');
      const repeats = state.failure?.fingerprint === fingerprint ? (state.failure.repeats ?? 1) + 1 : 1;

      if (repeats >= MAX_REPEATS) {
        // Recorded against the content that failed, not against the session: the moment one of these
        // files is edited again its hash stops matching and the gate checks it afresh.
        for (const { path: file, hash } of toCheck) state.gaveUp[file] = hash;
        delete state.failure;
        store.write(state);
        audit('ran', changed.length, files.length, 'giveup', check, check);
        const seeIt = check === 'docs' ? DOCS_CHECK_COMMAND : guardCommand;
        return {
          stdout: JSON.stringify({
            systemMessage:
              `${message} - ${check} still fails after ${repeats} identical attempts, letting the stop through. ` +
              `Nothing was fixed; run \`${seeIt}\` to see it.`,
          }),
          exitCode: 0,
        };
      }

      // Only the counter is persisted on a failure. Nothing enters `verified`: the tree is still broken.
      store.write({ ...state, failure: { fingerprint, repeats, check } });
      audit('ran', changed.length, files.length, 'fail', check, check);

      const reproduce = check === 'docs' ? DOCS_CHECK_COMMAND : `${guardCommand} --changed ${files.join(' ')}`;
      const stderr = `${[
        `Guard gate: ${check} failed on ${files.length} changed file(s).`,
        fileList(files),
        '',
        errorDetails(output),
        '',
        `Fix it and stop again. To reproduce: ${reproduce}`,
        repeats + 1 >= MAX_REPEATS ? 'One more identical failure and the gate gives up and lets the stop through.' : '',
      ]
        .filter(Boolean)
        .join('\n')}\n`;
      return { stdout: JSON.stringify({ systemMessage: message }), stderr, exitCode: 2 };
    }

    for (const step of steps) {
      ran.push(step.name);
      const run = spawnSync(step.argv[0], step.argv.slice(1), {
        cwd: root,
        encoding: 'utf8',
        timeout: step.timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, HONEST_DOCS_SCRIPTS: scripts },
      });

      if (run.error || run.status === null) {
        const code = run.error?.code ?? 'killed';
        audit('ran', changed.length, files.length, 'error', step.check === 'docs' ? `docs-check ${code}` : code);
        return { exitCode: 0 }; // A gate that cannot run must not be a gate that blocks.
      }
      if (run.status !== 0) {
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
        return block(step.check ?? failedCheck(output), output, ranMessage());
      }
    }

    for (const { path: file, hash } of toCheck) {
      state.verified[file] = hash;
      delete state.gaveUp[file];
    }
    delete state.failure;
    store.write(state);
    audit('ran', changed.length, files.length, 'pass', hasGuard ? '' : 'docs-check-only');
    return { stdout: JSON.stringify({ systemMessage: ranMessage() }), exitCode: 0 };
  } catch (error) {
    // Every internal failure ends here: a broken gate exits 0. It must never be the reason work
    // cannot be handed back.
    audit('skipped', 0, 0, '-', `internal-error: ${error?.message ?? error}`);
    return { exitCode: 0 };
  }
}
