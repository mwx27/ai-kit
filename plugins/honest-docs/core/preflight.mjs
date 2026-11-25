// What /honest-docs:init has to settle with the user before it writes anything
// (scripts/install.mjs --preflight): whether the project has no code yet, and whether git would
// ignore what init writes.
//
// `empty` means no code, judged by the files at the top of the folder, not by commits: a repo
// created on GitHub has a commit holding only a README. It is true when every entry is one a
// generator tolerates, a README or LICENSE, or what Claude Code and honest-docs put there.
// Generators such as create-next-app and create-expo-app refuse a folder holding files they do not
// expect, CLAUDE.md among them, so init before the app is generated would leave them nothing to run in.
//
// `blocking` lists the entries that create-next-app or create-expo would refuse, so the user can move
// them aside before generating. It is meaningful only when `empty` is true.
//
// `ignored` lists the files install maintains (core/install.mjs maintainedFiles) that git ignores,
// `{ file, source, pattern }` as core/git-ignored.mjs gives them: what init writes has to reach the
// repo, or the checks run only on this machine. Git answers for files that do not exist yet; outside
// a repository the list is empty.
//
// The tolerated names are copied from the generators' sources; newer versions may change them:
//   create-next-app 16.4.6   isFolderEmpty, dist/index.js
//   create-expo 5.1.9        tolerableFiles, build/536.index.js (create-expo-app 5.0.0 runs it)
import { readdirSync } from 'node:fs';
import { ignoredByGit } from './git-ignored.mjs';
import { maintainedFiles } from './install.mjs';

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

// Repository and editor settings a repo created on a forge or by hand often starts with.
const SETTINGS = new Set(['.github', '.editorconfig', '.nvmrc', '.node-version', '.tool-versions']);

/**
 * Not code, though a generator may refuse it: a README or LICENSE/LICENCE, with an extension or none;
 * repository and editor settings; and the agent files, CLAUDE.md, AGENTS.md and .claude/.
 */
const notCode = (name) =>
  /^(readme|licen[cs]e)(\.[\w.-]+)?$/i.test(name) || SETTINGS.has(name) || ['CLAUDE.md', 'AGENTS.md', '.claude'].includes(name);

/** `{ empty, blocking, ignored }` for the project at `root`; `blocking` sorted. */
export function preflight(root, config) {
  const entries = readdirSync(root).sort();
  const empty = entries.every((name) => tolerated(NEXT, name) || tolerated(EXPO, name) || notCode(name));
  const blocking = entries.filter((name) => !tolerated(NEXT, name) || !tolerated(EXPO, name));
  const ignored = ignoredByGit(root, maintainedFiles(config)).map(({ file, source, pattern }) => ({ file, source, pattern }));
  return { empty, blocking, ignored };
}
