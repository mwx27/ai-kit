// The `covers:` frontmatter of the docs in docsDir — root-anchored globs of the code each doc
// describes. Read by core/reminder.mjs after every tool call and checked by scripts/docs-check.mjs,
// so the two cannot disagree about what a doc covers.
//
// scripts/context-budget.mjs has its own matcher on purpose: it reproduces Claude Code's unanchored
// `paths:` matching, so the two are different semantics, not a duplicate.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const escapeRe = (c) => (/[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c);

/** Glob → RegExp for repo-relative POSIX paths, anchored at the root: **, *, ?, {a,b}. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{' && glob.indexOf('}', i) !== -1) {
      const end = glob.indexOf('}', i);
      const options = glob.slice(i + 1, end).split(',');
      re += `(?:${options.map((opt) => [...opt].map(escapeRe).join('')).join('|')})`;
      i = end;
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/** The `covers:` list out of a doc's YAML frontmatter. Only the one key is needed, so no YAML parser. */
function coversOf(text) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  const globs = [];
  if (!frontmatter) return globs;

  let inCovers = false;
  for (const line of frontmatter[1].split('\n')) {
    if (/^covers:\s*$/.test(line)) {
      inCovers = true;
      continue;
    }
    if (!inCovers) continue;
    const item = line.match(/^\s*-\s*['"]?(.+?)['"]?\s*$/);
    if (item) globs.push(item[1]);
    else if (line.trim() !== '') inCovers = false;
  }
  return globs;
}

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return entry.endsWith('.md') ? [full] : [];
  });
}

/**
 * A `covers:` key anywhere in a frontmatter block, CRLF included — what the doc meant to declare,
 * whether or not coversOf could read a glob out of it.
 */
const declaresCovers = (text) => /^covers:/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');

/**
 * Every doc in docsDir that declares `covers:`, with its globs compiled. `globs` is empty when the
 * key is there in a form coversOf does not read (CRLF, `covers: []`, a one-line value).
 */
export function readCovers(root, docsDir) {
  const dir = path.join(root, docsDir);
  if (!existsSync(dir)) return [];

  return markdownFiles(dir)
    .map((file) => {
      const text = readFileSync(file, 'utf8');
      const globs = coversOf(text);
      return {
        doc: path.relative(root, file).split(path.sep).join('/'),
        declared: globs.length > 0 || declaresCovers(text),
        globs,
        patterns: globs.map(globToRegExp),
      };
    })
    .filter(({ declared }) => declared);
}

export const isDoc = (file, docsDir) => file.startsWith(`${docsDir}/`) && file.endsWith('.md');
