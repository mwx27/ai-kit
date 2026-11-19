# Choosing the docs folder

`/honest-docs:init` asks which folder holds the project's docs and writes the answer as `docsDir`
in `.claude/honest-docs.json`. This page is the longer answer behind that question.

## Docs about the code, not a website

`docsDir` is for docs about the code, read by the people and agents who change it: why a feature
works the way it does, what a tool is for. Each doc there carries a `**Last Updated:**` line, a
feature or tool doc names the code it describes in `covers:`, and the Stop gate keeps them in step
with that code ([`hooks.md`](hooks.md)).

Documentation for the product's users is a different thing: a website built from a folder, often
`docs/`, by GitHub Pages, Docusaurus, MkDocs or VitePress. Do not point `docsDir` at such a folder:
the gate would start guarding the website's pages, and they would get `covers:` and Last Updated
lines that do not belong on a public site.

## The choices

- **`_docs/`**, the default. The underscore keeps the folder near the top of the file tree, and it
  leaves the name `docs/` free for a documentation website.
- **`docs/`**, the most familiar name. Pick it only when the project does not publish a website
  from `docs/`.
- **A folder the project already has**, which keeps the docs where they are, so no link breaks.
  Pick it only when it holds docs about the code, not a website's pages.

## Both `_docs/` and `docs/`

Two folders are sound when their readers differ: `docs/` is the website for users, `_docs/` the
knowledge about the code. They are a mess when both hold the same kind of text: nobody knows where
a new fact goes, and it ends up in both. Without a website, keep one folder.

With both, two things keep them apart:

- One line where the agent reads it, in `CLAUDE.md` or a rule file of your own: "`docs/` is the
  published user site; facts about the code go to `_docs/`."
- Optionally, the docs check over the website too. Add `docs` to `scan.dirs` in
  `.claude/honest-docs.json`; the list replaces the default, so keep its entries:
  `{ "scan": { "dirs": ["_docs", ".claude/rules", ".claude/skills", "docs"] } }`. The check then
  reports broken links, paths and scripts there, without asking for `covers:` or Last Updated
  lines, which only `docsDir` needs.

## Moving the docs later

init never moves docs. To move them after installing:

1. `git mv` the folder to its new place.
2. Set `docsDir` to it in `.claude/honest-docs.json`.
3. Run `/honest-docs:update`, which rewrites the docs rule and its line in `CLAUDE.md` for the new
   folder.
4. Run `node .claude/honest-docs/scripts/docs-check.mjs`: it lists every link and path the move
   broke, to fix one by one.
