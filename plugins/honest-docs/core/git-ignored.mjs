// Which paths git ignores, asked in one call. init warns about a file it maintains that nobody else
// would get; docs-check skips a path a doc names that git ignores, since whether it exists depends
// on the machine. check-ignore answers for paths that do not exist too.
import { execFileSync } from 'node:child_process';

/**
 * The files among `files` git ignores, `{ file, source }` with source `<file>:<line>:<pattern>`.
 * Empty without git or outside a repo. A tracked file is never reported: git commits it anyway.
 * A path outside the repo fails the whole call, so the caller leaves those out.
 */
export function ignoredByGit(root, files) {
  if (files.length === 0) return [];
  let output;
  try {
    // -z needs --stdin. Its fields are NUL-separated, so a source path holding a colon (a Windows
    // core.excludesFile, C:/…) cannot be misread.
    output = execFileSync('git', ['-C', root, 'check-ignore', '-v', '-z', '--stdin'], {
      encoding: 'utf8',
      input: files.map((file) => `${file}\0`).join(''),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    // Exit 1 is "none ignored"; anything else (no git, no repo) means no check.
    return [];
  }
  const fields = output.split('\0');
  const ignored = [];
  // Four fields per path: source, line, pattern, path.
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, line, pattern, file] = fields.slice(i, i + 4);
    // With -v a negated pattern that matched is printed too, though the file is not ignored.
    if (!pattern.startsWith('!')) ignored.push({ file, source: `${source}:${line}:${pattern}` });
  }
  return ignored;
}
