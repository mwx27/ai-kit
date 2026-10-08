---
paths:
  - '{{docsDir}}/**/*.md'
---

# Writing docs in `{{docsDir}}/`

**One fact, one home** — everywhere else links to it. A copy means two edits per change, and one gets
forgotten.

**Write only what the code can't carry:** why it's built this way, what was rejected, what breaks on
the obvious "fix". Re-derivable from the source in a minute → skip it.

## Don't write

- **What a component renders** — prop lists, folder layouts, token values, `package.json` scripts.
- **Pasted source** — a code block reproducing a file is a second copy that rots on the next edit,
  and the file is one click away.
- **Design node ids** — the design file is the truth for how a screen looks, and no doc stays in sync
  with it.
- Anything the generated API contract or `git log` already answers.
- **Empty shells and roadmaps** — a doc starts at a feature's first non-obvious why, not at its
  folder.
- **Where the project currently stands** — a `Not implemented yet` / `What's not in scope` /
  phased-roadmap section names no symbol, so the grep that catches lying docs never reaches it, and
  it goes false the week the feature lands. A deliberate non-decision earns a home only when it says
  what would change the answer.
- **Library basics** — only our workaround for a trap in one.

## Shape

Add a **per-feature doc** (`{{docsDir}}/features/{feature}.md`) when a feature has non-obvious whys worth
keeping: a flow that can't be read off one file, a trap someone will hit twice, a decision whose
obvious alternative is wrong. **Tool docs** (`{{docsDir}}/tools/{tool}.md`) do the same for a standalone
module like the logger server.

**A feature doc opens with what the feature is for** — one short paragraph for someone who does not
know the app: what it does for the user and why it has this shape; a flow adds its steps as the
user sees them, one line each. Keep only what survives a redesign of the screen: no UI copy, no
values, no layout. For example: _sign-in codes arrive by email, not SMS, so the phone never offers
to fill them in; the screen watches the clipboard instead, and that is the only reason that code
exists._

**Then traps and gotchas first** in a doc past roughly 100 lines. A doc is read under time pressure
and often not to the end; the sections that justify its existence go at the top, above layout or
wire-up.

A new `features/` or `tools/` doc declares the code it describes as `covers:` in YAML frontmatter —
globs anchored at the repo root, as narrow as its subject; a doc with no code scope has none.

## Maintenance

`Last Updated` is set by the guard gate at the end of every turn that changed the doc — never set the
date by hand. A new doc carries the line under its H1 with any date, and the gate sets the real one;
docs-check fails a doc without it.

**A correction replaces the sentence it corrects.** History lives in git or in `artifacts/`, not in
dated layers inside the doc (`Correction, <date>`, `Since…`, `Caveat…`).

**In the same change as the code:** a line in the {{indexFile}} docs index for any new
`{{docsDir}}/features|tools/` file.

**The backlog holds blockers, and only code in this repo** — things to write or delete before
real users arrive. A third-party dashboard setting, a task for a backend, a note that something is
unverified: none of those belong, because nobody can clear them by editing this repo.

`honest-docs-check` (run by the guard gate at the end of every turn) verifies every link, anchor,
path, npm script and `covers:` glob a doc names still resolves, and that every doc in `{{docsDir}}/`
has its `Last Updated` line — it does not verify that prose is true. When covered code changes, a
hook names the doc once per session; whether a sentence went false is yours to judge.

Written by /honest-docs:init {{version}} — fixes go to the plugin, not this file.
