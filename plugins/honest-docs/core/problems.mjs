// "Don't make it worse": which docs-check problems are new against the session's start set, and
// which of those the session caused.
//
// The start set is what docs-check reported when the session started (core/session-start.mjs), kept
// in the session's state (core/session-state.mjs). A problem is keyed by check, file and message,
// never the line, so lines moving above it leave the key alone; two occurrences of one key in a doc
// are two problems, and only those past the start set's count are new.
//
// A new problem is caused by the session when its file, or one of its `related` paths, is among the
// paths attributed to the session (core/attribution.mjs). A config the session changed makes every
// new problem caused, since it sets what is scanned and accepted; a `covers` glob that matches no
// file is caused when the session deleted a file matching it (an approximation: a file that merely
// stopped matching is not seen).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CONFIG_FILE, COPY_DIR } from './config.mjs';
import { globToRegExp } from './doc-covers.mjs';
import { PLUGIN_ROOT } from './log.mjs';

/** What the agent or the user runs, from the project root, to list the problems. */
export const docsCheckCommand = () => `node ${COPY_DIR}/scripts/docs-check.mjs`;

/**
 * docs-check --json from the scripts/ of `codeRoot` (the running code by default) → { problems } or
 * { error }. `error` names what went wrong in a few words: a timeout, an exit code, output that is
 * not the JSON.
 */
export function runDocsCheck(root, timeout, codeRoot = PLUGIN_ROOT) {
  const run = spawnSync(process.execPath, [path.join(codeRoot, 'scripts', 'docs-check.mjs'), '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.error || run.status === null) return { error: `docs-check ${run.error?.code ?? 'killed'}` };
  if (run.status !== 0) return { error: `docs-check exit ${run.status}` };
  try {
    const { problems } = JSON.parse(run.stdout);
    if (Array.isArray(problems)) return { problems };
  } catch {
    // Reported below.
  }
  return { error: 'docs-check output unreadable' };
}

/** A problem's identity: no line number, so it survives lines moving above it. */
export const problemKey = ({ check, file, message }) => JSON.stringify([check, file, message]);

/** Findings → [{ check, file, message, count }], one per key, in first-seen order. */
export function countByKey(findings) {
  const counts = new Map();
  for (const { check, file, message } of findings) {
    const key = problemKey({ check, file, message });
    const entry = counts.get(key) ?? { check, file, message, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()];
}

/**
 * The findings past each key's count in `start` (countByKey's output). The last occurrences in doc
 * order are the new ones, so the line shown is a real one.
 */
export function newOccurrences(findings, start) {
  const known = new Map(start.map((entry) => [problemKey(entry), entry.count]));
  const byKey = new Map();
  for (const finding of findings) {
    const key = problemKey(finding);
    byKey.set(key, [...(byKey.get(key) ?? []), finding]);
  }
  return [...byKey].flatMap(([key, group]) => group.slice(known.get(key) ?? 0));
}

const withSlash = (p) => p.replace(/\/?$/, '/');
/**
 * `hooks/useAnalytics` in prose is an import specifier: the file is `hooks/useAnalytics.ts`, or a
 * folder with an index. docs-check accepts it so, and the gate takes a change to that file as one to
 * the path.
 */
export const SPECIFIER_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/**
 * `attributed` names `p`: the same path with or without a trailing slash, a path under folder `p`, or
 * the file `p` resolves to as an import specifier (`hooks/useAnalytics` → `hooks/useAnalytics.ts`).
 */
export function names(attributed, p) {
  if (attributed === p || withSlash(attributed) === withSlash(p) || attributed.startsWith(withSlash(p))) return true;
  const bare = p.replace(/\/$/, '');
  return SPECIFIER_EXTENSIONS.some((ext) => attributed === `${bare}${ext}` || attributed === `${bare}/index${ext}`);
}

const COVERS_NO_MATCH = 'covers matches no file: ';

/** Whether the session caused `problem`, given `attributed` (core/attribution.mjs readAttributed). */
export function causedBy(problem, attributed) {
  if (attributed.has(CONFIG_FILE)) return true;
  const paths = [...attributed.keys()];
  if ([problem.file, ...(problem.related ?? [])].some((p) => paths.some((a) => names(a, p)))) return true;
  if (problem.check === 'covers' && problem.message.startsWith(COVERS_NO_MATCH)) {
    const pattern = globToRegExp(problem.message.slice(COVERS_NO_MATCH.length));
    return [...attributed].some(([file, { deleted }]) => deleted && pattern.test(file));
  }
  return false;
}
