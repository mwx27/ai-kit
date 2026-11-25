// Whether a project has no code yet, for /honest-docs:init to ask about generating the app first
// (scripts/install.mjs --check-empty). Generators such as create-next-app and create-expo-app refuse
// a folder holding files they do not expect, CLAUDE.md among them, so init in an empty repo, before
// the app is generated, would leave the generator nothing it can run in.
//
// `empty` means no code, judged by the files at the top of the folder, not by commits: a repo
// created on GitHub has a commit holding only a README. It is true when every entry is one a
// generator tolerates, a README or LICENSE, or what Claude Code and honest-docs put there.
//
// `blocking` lists the entries that create-next-app or create-expo would refuse, so the user can move
// them aside before generating. It is meaningful only when `empty` is true.
//
// The tolerated names are copied from the generators' sources; newer versions may change them:
//   create-next-app 16.4.6   isFolderEmpty, dist/index.js
//   create-expo 5.1.9        tolerableFiles, build/536.index.js (create-expo-app 5.0.0 runs it)
import { readdirSync } from 'node:fs';

const NEXT = new Set([
  '.claude', '.cursor', '.DS_Store', '.git', '.gitattributes', '.gitignore', '.gitlab-ci.yml', '.hg',
  '.hgcheck', '.hgignore', '.idea', '.npmignore', '.travis.yml', '.vscode', '.zed', 'LICENSE',
  'Thumbs.db', 'docs', 'mkdocs.yml', 'npm-debug.log', 'yarn-debug.log', 'yarn-error.log', 'yarnrc.yml',
  '.yarn',
]);
const EXPO = new Set([
  '.DS_Store', 'Thumbs.db', '.git', '.gitattributes', '.gitignore', '.npmignore', 'LICENSE', 'docs',
  '.idea', 'npm-debug.log', 'yarn-debug.log', 'yarn-error.log',
]);
// Both generators also tolerate any *.iml (IntelliJ module files).
const tolerated = (set, name) => set.has(name) || /\.iml$/.test(name);

/** Not code, though a generator may refuse it. */
const notCode = (name) => /^(readme|license)/i.test(name) || name === 'CLAUDE.md' || name === '.claude';

/** `{ empty, blocking }` for the folder `root`; `blocking` sorted. */
export function checkEmpty(root) {
  const entries = readdirSync(root).sort();
  const empty = entries.every((name) => tolerated(NEXT, name) || tolerated(EXPO, name) || notCode(name));
  const blocking = entries.filter((name) => !tolerated(NEXT, name) || !tolerated(EXPO, name));
  return { empty, blocking };
}
