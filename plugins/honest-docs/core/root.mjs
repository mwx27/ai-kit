// The project a hook acts on.
//
// The git repository holding the hook input's `cwd`. Claude Code keeps CLAUDE_PROJECT_DIR at the
// folder the session started in, while `cwd` is the worktree root in a worktree session and follows
// a `cd` (worktrees docs), so `cwd` is what names the tree being worked on. Without git, or outside
// a repo: CLAUDE_PROJECT_DIR, else `cwd`.
//
// The copy's hooks (.claude/honest-docs/ in a project, core/version.mjs) act only where that root
// holds a copy (.claude/honest-docs/manifest.json): `cwd` may name a sibling repo the session `cd`'d
// into. Run from anywhere but a copy, they do nothing.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { COPY_DIR } from './config.mjs';
import { PLUGIN_ROOT } from './log.mjs';
import { MANIFEST, isCopy } from './version.mjs';

/** Hook input → the root of the repository it names, whether or not it holds a copy. */
export function repoRoot(input) {
  const fallback = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  try {
    // resolve(): git prints C:/… on Windows, the form path.join would not give.
    return path.resolve(
      execFileSync('git', ['-C', input?.cwd || fallback, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );
  } catch {
    return fallback;
  }
}

/** Hook input → the project root, or null when the running code's hook has nothing to do there. */
export function hookRoot(input, codeRoot = PLUGIN_ROOT) {
  if (!isCopy(codeRoot)) return null;
  const root = repoRoot(input);
  return existsSync(path.join(root, COPY_DIR, MANIFEST)) ? root : null;
}
