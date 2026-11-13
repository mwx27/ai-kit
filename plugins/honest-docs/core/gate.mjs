// Stop gate: blocks the end of a turn whose own changes made the docs worse or fail the project's
// guard.
//
// It replaces the instruction telling the agent to remember to run the checks — a rule that costs
// context in every session and is forgotten in the one where it matters. Nothing is reimplemented
// here: it runs scripts/docs-check.mjs, then the project's guard as configured in `guard.command`
// (core/config.mjs), with HONEST_DOCS_SCRIPTS pointing at the scripts/ beside the running code: the
// plugin's, or the project's copy (core/version.mjs).
//
// What it runs on: the paths this session's tool calls changed (core/attribution.mjs), deleted ones
// included, minus what already passed in this exact content (core/session-state.mjs). Nothing
// attributed, nothing run: a session that only reads, beside one that writes, is never blocked, and
// neither is one whose user edits files in an editor.
//
// "Don't make it worse": docs-check runs on the whole docs tree, since a code change can break a
// doc, but only a problem that is new against the session's start set and caused by the session
// blocks (core/problems.mjs), as check `docs`; the guard then does not run. New problems the session
// did not cause are named to the user, not the agent. With no start set (the hooks arrived
// mid-session) or one taken by another code version (an update during the session), the stop takes
// a new one from the current problems and does not block on the docs: a stricter check is not the
// session making things worse.
//
// Guard contract: `<command…> --changed <files…>`, exit 0 on success. On failure it may print
// `GUARD_FAIL check=<name>` to name the check (default `guard`). Its output for one failure must be
// the same run to run, apart from what normalize() strips. It need not run docs-check; one that
// still does runs it a second time, which costs time and nothing else.
//
// A guard that could not check — its environment is missing something, not the code — exits
// non-zero and prints `GUARD_ERROR reason=<text>`. The stop goes through, the files are not
// recorded as verified, so the next stop checks them again, and the user is told why. A
// `GUARD_FAIL` line in the same output wins: that is a failure and blocks. A non-zero exit with
// neither line is a failure too.
//
// It also writes to the tree, and only to docs: before the checks run, each attributed doc it is
// about to check that carries a Last Updated line gets it restamped (core/last-updated.mjs).
//
// Loop protection is deliberately not "exit 0 on stop_hook_active" — that disarms the gate the
// first time the agent stops twice, which is exactly when it is doing the work. Instead the same
// failure (same files, same output) may block twice; the third identical one is let through and the
// files are recorded in `gaveUp` at their current content. The concession is per file per content:
// edit one of them again and its hash no longer matches, so the gate picks it back up. It adds
// nothing to the start set.
//
// From a copy in a worktree whose own copy is another version, the running code is the main
// checkout's (CLAUDE_PROJECT_DIR stays there), so the turn is skipped and the user told.
//
// Every invocation appends one line to <logDir>/guard-gate-<session>.log:
//   <ISO>  ran|skipped  changed=<n> checked=<n>  ms=<n>  pass|fail|giveup|unchecked|error|-  [reason]
// so the question "what does this gate actually cost per turn" is answered by the log, not by
// an estimate. `changed` counts the attributed paths. `ran` means docs-check was started. A pass
// with no guard configured carries the reason `docs-check-only`, and a stop that took the start set
// `start-set-at-stop` or `start-set-renewed`; `unchecked` carries the guard's GUARD_ERROR reason,
// and `error` means a step could not be run at all. The same outcome goes to the shared event log
// (core/log.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readAttributed, removeStalePre } from './attribution.mjs';
import { hashFiles } from './changed-files.mjs';
import { COPY_DIR, ConfigError, loadConfig } from './config.mjs';
import { stampLastUpdated } from './last-updated.mjs';
import { PLUGIN_ROOT, logEvent, pluginVersion } from './log.mjs';
import { causedBy, countByKey, docsCheckCommand, newOccurrences, runDocsCheck } from './problems.mjs';
import { hookRoot } from './root.mjs';
import { readStartSet, sessionDir, sessionKey, sessionStore, writeStartSet } from './session-state.mjs';
import { installedVersion, isCopy } from './version.mjs';

/** Identical failures tolerated before the gate concedes and lets the stop through. */
const MAX_REPEATS = 3;
// docs-check and the guard run one after the other, so the two together must fit the Stop hook's
// timeout (180 s in hooks/hooks.json), or Claude Code kills the gate before it can answer.
const DOCS_CHECK_TIMEOUT_MS = 20_000;
const GUARD_TIMEOUT_MS = 150_000;
const DETAIL_LINES = 12;
const LISTED_FILES = 10;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** `doc:line  message` for each problem, as docs-check prints them. */
const problemLines = (problems) => problems.map((f) => `${f.file}${f.line ? `:${f.line}` : ''}  ${f.message}`).join('\n');

/** Strips colour, per-run timings and log timestamps, so two identical failures hash identically. */
function normalize(output) {
  return output
    .replace(ANSI, '')
    .replace(/\(\d+s\)/g, '')
    .replace(/\d{8}_\d{6}/g, '')
    .trim();
}

const GUARD_FAIL = /GUARD_FAIL check=(\S+)/;

/** `GUARD_FAIL check=eslint files=2` — the line the guard prints before it stops. */
function failedCheck(output) {
  return output.match(GUARD_FAIL)?.[1] ?? 'guard';
}

/** The reason in `GUARD_ERROR reason=<text>`, or null without that line or with GUARD_FAIL beside it. */
function guardError(output) {
  if (GUARD_FAIL.test(output)) return null;
  const reason = normalize(output).match(/^GUARD_ERROR reason=(.*)$/m)?.[1].trim();
  return reason === undefined ? null : reason || 'no reason given';
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

/** 1 file / 2 files — the message is read by a person, so it agrees with the number. */
const plural = (count) => (count === 1 ? 'file' : 'files');

function fileList(files) {
  const shown = files.slice(0, LISTED_FILES).map((file) => `  ${file}`);
  if (files.length > LISTED_FILES) shown.push(`  ... and ${files.length - LISTED_FILES} more`);
  return shown.join('\n');
}

/** Hook input → { stdout, stderr, exitCode }. Exit 2 with stderr blocks the stop. */
export function gate(input) {
  const start = Date.now();
  const root = hookRoot(input);
  if (root === null) return { exitCode: 0 };
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

    // From a copy, the hooks are the main checkout's (CLAUDE_PROJECT_DIR); a worktree on another
    // version would be checked by code that is not its own.
    if (isCopy(PLUGIN_ROOT)) {
      let theirs = null;
      try {
        theirs = installedVersion(path.join(root, COPY_DIR));
      } catch {
        // Unreadable: not the running version either.
      }
      if (theirs !== pluginVersion()) {
        audit('skipped', 0, 0, '-', 'version-mismatch');
        return {
          stdout: JSON.stringify({
            systemMessage:
              `honest-docs: this tree holds honest-docs ${theirs ?? '(version unreadable)'}, the hooks running are ` +
              `${pluginVersion()}. The Stop gate checked nothing this turn.`,
          }),
          exitCode: 0,
        };
      }
    }

    const dir = sessionDir(root, config, session);
    removeStalePre(dir);
    const attributed = readAttributed(dir);
    if (attributed.size === 0) {
      audit('skipped', 0, 0, '-', 'nothing-attributed');
      return { exitCode: 0 };
    }

    const hashes = hashFiles(root, [...attributed.keys()]);
    if (hashes === null) {
      audit('skipped', attributed.size, 0, '-', 'no-git'); // Nothing is known about the tree, so nothing is blocked.
      return { exitCode: 0 };
    }
    const changed = attributed.size;

    const store = sessionStore(dir, session);
    const state = store.read() ?? { verified: {}, gaveUp: {} };
    // A deleted path has hash null and counts: deleting a file a doc names is a change to check.
    let toCheck = [...hashes]
      .map(([file, hash]) => ({ path: file, hash }))
      .filter(({ path: file, hash }) => state.verified[file] !== hash && state.gaveUp[file] !== hash);
    const files = toCheck.map(({ path: file }) => file);

    if (files.length === 0) {
      audit('skipped', changed, 0, '-', 'nothing-new');
      return { exitCode: 0 };
    }

    // Stamped before the checks run, so formatters and docs-check see the final content — and
    // rehashed, so `verified` records the stamped file and the next stop does not take it for a new edit.
    const present = toCheck.filter(({ hash }) => hash !== null).map(({ path: file }) => file);
    const stamped = stampLastUpdated(root, present, config.timeZone);
    if (stamped.length > 0) {
      const fresh = hashFiles(root, stamped) ?? new Map();
      toCheck = toCheck.map((entry) => ({ ...entry, hash: fresh.get(entry.path) ?? entry.hash }));
    }

    const scripts = path.join(PLUGIN_ROOT, 'scripts');
    const command = config.guard.command;
    const hasGuard = Array.isArray(command) && command.length > 0;
    const guardCommand = hasGuard ? command.join(' ') : '';

    const checksStart = Date.now();
    const ran = [];
    let others = '';
    const ranMessage = () =>
      `${ran.join(', ')}: ${files.length} ${plural(files.length)}, ${((Date.now() - checksStart) / 1000).toFixed(1)}s${others}`;
    const notes = [];
    const withNotes = (reason) => [reason, ...notes].filter(Boolean).join(' ');

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
        audit('ran', changed, files.length, 'giveup', withNotes(check), check);
        const seeIt = check === 'docs' ? docsCheckCommand() : guardCommand;
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
      audit('ran', changed, files.length, 'fail', withNotes(check), check);

      const reproduce = check === 'docs' ? docsCheckCommand() : `${guardCommand} --changed ${present.join(' ')}`;
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

    // docs-check first: a guard that fails on code would otherwise hide a broken doc until it passes.
    ran.push('docs-check');
    const docs = runDocsCheck(root, DOCS_CHECK_TIMEOUT_MS);
    if (docs.error) {
      audit('ran', changed, files.length, 'error', docs.error);
      return {
        stdout: JSON.stringify({ systemMessage: `honest-docs: ${docs.error}; the Stop gate checked nothing this turn.` }),
        exitCode: 0,
      };
    }
    const startSet = readStartSet(dir);
    if (startSet === null || startSet.version !== pluginVersion()) {
      writeStartSet(dir, { version: pluginVersion(), takenBy: 'stop', problems: countByKey(docs.problems) });
      notes.push(startSet === null ? 'start-set-at-stop' : 'start-set-renewed');
    } else {
      const fresh = newOccurrences(docs.problems, startSet.problems);
      const caused = fresh.filter((problem) => causedBy(problem, attributed));
      const elsewhere = fresh.length - caused.length;
      // For the user: the agent is not told, so it does not set about fixing another session's work.
      if (elsewhere > 0)
        others = ` - ${elsewhere} new docs problem${elsewhere === 1 ? '' : 's'} not from this session (\`${docsCheckCommand()}\` lists them)`;
      if (caused.length > 0) return block('docs', problemLines(caused), ranMessage());
    }

    if (hasGuard) {
      ran.push('guard --changed');
      const run = spawnSync(command[0], [...command.slice(1), '--changed', ...present], {
        cwd: root,
        encoding: 'utf8',
        timeout: GUARD_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, HONEST_DOCS_SCRIPTS: scripts },
      });

      if (run.error || run.status === null) {
        audit('ran', changed, files.length, 'error', withNotes(run.error?.code ?? 'killed'));
        return { exitCode: 0 }; // A gate that cannot run must not be a gate that blocks.
      }
      if (run.status !== 0) {
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
        const reason = guardError(output);
        if (reason !== null) {
          // Not a verdict on the files: nothing enters `verified` or the repeat count, and the stop
          // goes through. The user is told; the agent is not, so it does not set about fixing the
          // environment.
          audit('ran', changed, files.length, 'unchecked', withNotes(reason));
          return {
            stdout: JSON.stringify({
              systemMessage:
                `${ranMessage()} - the guard could not check (${reason}): ` +
                `${files.length} ${plural(files.length)} unverified, checked again at the next stop.`,
            }),
            exitCode: 0,
          };
        }
        return block(failedCheck(output), output, ranMessage());
      }
    }

    for (const { path: file, hash } of toCheck) {
      state.verified[file] = hash;
      delete state.gaveUp[file];
    }
    delete state.failure;
    store.write(state);
    audit('ran', changed, files.length, 'pass', withNotes(hasGuard ? '' : 'docs-check-only'));
    return { stdout: JSON.stringify({ systemMessage: ranMessage() }), exitCode: 0 };
  } catch (error) {
    // Every internal failure ends here: a broken gate exits 0. It must never be the reason work
    // cannot be handed back, and it must not pass for a gate that ran, so each one is reported. A
    // config the project broke gets its own message naming the file; its reason in the event log
    // carries no file content.
    if (error instanceof ConfigError) {
      audit('skipped', 0, 0, '-', 'config-error');
      return {
        stdout: JSON.stringify({ systemMessage: `honest-docs: ${error.message}. The Stop gate checked nothing this turn.` }),
        exitCode: 0,
      };
    }
    const detail = error?.message ?? String(error);
    audit('skipped', 0, 0, '-', `internal-error: ${detail}`);
    return {
      stdout: JSON.stringify({ systemMessage: `honest-docs: the Stop gate failed (${detail}) and checked nothing this turn.` }),
      exitCode: 0,
    };
  }
}
