// The project a hook acts on.
//
// From a copy (.claude/honest-docs/ in a project, core/version.mjs): the git repository holding the
// hook input's `cwd`. Claude Code keeps CLAUDE_PROJECT_DIR at the folder the session started in, while
// `cwd` is the worktree root in a worktree session and follows a `cd` (worktrees docs), so `cwd` is
// what names the tree being worked on. It may also name a sibling repo the session `cd`'d into, so
// the hook acts only where the root holds a copy (.claude/honest-docs/manifest.json); elsewhere it
// does nothing.
//
// From the plugin: CLAUDE_PROJECT_DIR first, as 0.1.8 did, until the plugin stops carrying these
// hooks.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { COPY_DIR } from './config.mjs';
import { PLUGIN_ROOT } from './log.mjs';
import { MANIFEST, isCopy } from './version.mjs';

/** Hook input → the project root, or null when a copy's hook has nothing to do there. */
export function hookRoot(input, codeRoot = PLUGIN_ROOT) {
  const fallback = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  if (!isCopy(codeRoot)) return fallback;
  let root = fallback;
  try {
    // resolve(): git prints C:/… on Windows, the form path.join would not give.
    root = path.resolve(
      execFileSync('git', ['-C', input?.cwd || fallback, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );
  } catch {
    // No git, or not a repo: the root as 0.1.8 found it.
  }
  return existsSync(path.join(root, COPY_DIR, MANIFEST)) ? root : null;
}
