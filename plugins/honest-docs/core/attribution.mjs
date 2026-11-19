// Attribution: which paths this session's tool calls changed, so the gate checks those and nothing
// else — not the user's editor edits, not another session's work (plan, P2 and P3).
//
// Edit, Write and NotebookEdit name their file. Bash names nothing, so its PreToolUse stores the tree
// (core/changed-files.mjs treeSnapshot: the dirty paths and their hashes) under the call's
// tool_use_id, and its PostToolUse or PostToolUseFailure compares the tree with it. A path whose
// state moved in between is the call's. Two exceptions, both decided for not attributing, since a
// false block costs more than a gap:
// - no Pre for the call (hooks added mid-call, a Pre that timed out): nothing is recorded;
// - a path that went from dirty to as in HEAD with its content unchanged was committed, not changed.
//
// Everything changed inside a Bash call's window is the call's, another session's writes included:
// a documented limit. `git pull` and `git checkout` on a clean tree change no dirty path, so they
// attribute nothing; `git stash pop` does attribute what it brings back.
//
// attributed.jsonl takes one line per path, appended with one write each: hooks on one event run in
// parallel, and appends of a few hundred bytes do not interleave. A torn or unreadable line is skipped.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { ownDirs } from './config.mjs';
import { ignoredByGit } from './git-ignored.mjs';
import { posixPath } from './posix-path.mjs';
import { sessionKey, writeAtomic } from './session-state.mjs';
import { makeDir } from './state-dir.mjs';

/** A Pre with no Post (a cancelled or background Bash) is removed at Stop after this long. */
export const STALE_PRE_MS = 15 * 60 * 1000;

const ATTRIBUTED = 'attributed.jsonl';
const preFile = (dir, id) => path.join(dir, 'pre', `${sessionKey(id)}.json`);

/** Appends one line per `{ path, deleted }` in `entries`, made by tool `by` in call `id`. */
export function recordPaths(dir, { by, id, entries }) {
  if (entries.length === 0) return;
  makeDir(dir);
  const ts = new Date().toISOString();
  for (const { path: file, deleted } of entries)
    appendFileSync(path.join(dir, ATTRIBUTED), `${JSON.stringify({ ts, by, id, path: file, ...(deleted ? { deleted: true } : {}) })}\n`);
}

/** path → { deleted }, the last line for a path winning. Empty when nothing was attributed. */
export function readAttributed(dir) {
  const attributed = new Map();
  let text = '';
  try {
    text = readFileSync(path.join(dir, ATTRIBUTED), 'utf8');
  } catch {
    return attributed;
  }
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.path === 'string') attributed.set(entry.path, { deleted: entry.deleted === true });
    } catch {
      // A torn line (a crash mid-append) or the empty string after the last newline.
    }
  }
  return attributed;
}

export function putPre(dir, id, snapshot) {
  writeAtomic(preFile(dir, id), `${JSON.stringify({ tool_use_id: id, ts: new Date().toISOString(), snapshot })}\n`);
}

/** The Pre snapshot of call `id`, removed as it is read; null when there is none. */
export function takePre(dir, id) {
  const file = preFile(dir, id);
  let pre = null;
  try {
    pre = JSON.parse(readFileSync(file, 'utf8')).snapshot ?? null;
  } catch {
    return null;
  }
  rmSync(file, { force: true });
  return pre;
}

/** Removes Pre files older than `maxAge` ms. */
export function removeStalePre(dir, maxAge = STALE_PRE_MS, now = Date.now()) {
  const pre = path.join(dir, 'pre');
  let names = [];
  try {
    names = readdirSync(pre);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(pre, name);
    try {
      if (now - statSync(file).mtimeMs > maxAge) rmSync(file, { force: true });
    } catch {
      // Gone already: its Post read it.
    }
  }
}

/** path → blob sha in HEAD for `files`; a path HEAD lacks is absent. Empty without a HEAD. */
function headBlobs(root, files) {
  if (files.length === 0) return new Map();
  try {
    const out = execFileSync('git', ['--literal-pathspecs', '-C', root, 'ls-tree', '-z', '--full-tree', 'HEAD', '--', ...files], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    });
    return new Map(
      out
        .split('\0')
        .filter(Boolean)
        .map((record) => {
          const [meta, file] = record.split('\t');
          return [file, meta.split(' ')[2]];
        })
    );
  } catch {
    return new Map();
  }
}

const AS_IN_HEAD = Symbol('as in HEAD');
const valueOf = (snapshot, file) => (Object.hasOwn(snapshot, file) ? snapshot[file] : AS_IN_HEAD);

/**
 * The `{ path, deleted }` whose state differs between two treeSnapshots, except a path that went
 * from dirty to as in HEAD with the content it had: a commit, not a change.
 */
export function diffSnapshots(root, pre, post) {
  const moved = [...new Set([...Object.keys(pre), ...Object.keys(post)])].filter((file) => valueOf(pre, file) !== valueOf(post, file));
  const backToHead = moved.filter((file) => valueOf(post, file) === AS_IN_HEAD);
  const head = headBlobs(root, backToHead);
  return moved
    .filter((file) => !(valueOf(post, file) === AS_IN_HEAD && pre[file] === (head.get(file) ?? null)))
    .sort()
    .map((file) => ({ path: file, deleted: post[file] === null || (valueOf(post, file) === AS_IN_HEAD && !existsSync(path.join(root, file))) }));
}

/**
 * An absolute path's real form, through its nearest existing parent: macOS /var is /private/var. The
 * native call also expands a Windows 8.3 name (RUNNER~1), as git's --show-toplevel does.
 */
function realPath(abs) {
  try {
    return realpathSync.native(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(realPath(parent), path.basename(abs));
  }
}

/**
 * The repo-relative POSIX path an Edit, Write or NotebookEdit names (`file_path`, else
 * `notebook_path`), or null: outside the root, in the plugin's own folders, or ignored by git.
 */
export function toolPath(root, config, input) {
  const named = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof named !== 'string' || named === '') return null;
  const rel = posixPath(path.relative(realPath(root), realPath(path.resolve(input.cwd ?? root, named))));
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  if (ownDirs(config).some((dir) => rel.startsWith(dir))) return null;
  return ignoredByGit(root, [rel]).length > 0 ? null : rel;
}
