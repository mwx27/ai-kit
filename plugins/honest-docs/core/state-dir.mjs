// The one way the hooks create a folder for their state and logs. A folder inside STATE_ROOT
// (.claude/honest-docs-state/) gets that root's .gitignore of `*` with it, which ignores the root and
// the .gitignore itself, so nothing the hooks write reaches git status, whatever the project's own
// .gitignore says. Every writer goes through here: one that made its folder another way would leave
// the root without its .gitignore, and its files would be committed.
//
// A stateDir or logDir the config moves outside STATE_ROOT gets no .gitignore: the project chose
// that place, and init warns when git does not ignore it (core/install.mjs). Prettier does not read
// a nested .gitignore, so install also lists STATE_ROOT in .prettierignore.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATE_ROOT } from './config.mjs';

const ROOT_SEGMENTS = STATE_ROOT.split('/');

/** mkdir -p `dir` (absolute), then the .gitignore of the STATE_ROOT it lies in, if it lies in one. */
export function makeDir(dir) {
  mkdirSync(dir, { recursive: true });
  const parts = path.resolve(dir).split(path.sep);
  for (let end = parts.length; end >= ROOT_SEGMENTS.length; end--) {
    if (ROOT_SEGMENTS.every((segment, i) => parts[end - ROOT_SEGMENTS.length + i] === segment)) {
      const file = path.join(parts.slice(0, end).join(path.sep) || path.sep, '.gitignore');
      if (!existsSync(file)) writeFileSync(file, '*\n');
      return;
    }
  }
}
