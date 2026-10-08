# Changelog

All notable changes to the `honest-docs` plugin are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). It stays in the `0.x` range until the interface settles.

---

## [0.1.4] — 2026-10-08

### Changed

- **Tool docs and modules the user never sees open with what they are for too.** The docs rule's opening paragraph covers a feature or tool doc; for a module with no user-facing behaviour it says what the module does for the rest of the app. A second example shows one.
- **A rule tied to file paths now also loads when Claude creates a matching file — but only after the file is written.** Observed in October 2026; in September only reading a file loaded one. The plugin's reference docs say so, and draw the consequence: what a new file needs at its first write belongs in `CLAUDE.md` or a skill, not in such a rule.
- 0.1.4 changes the text of the docs rule: after updating, run `/honest-docs:init`.

---

## [0.1.3] — 2026-10-08

### Fixed

- **The docs rule's example no longer says something false.** It said a phone never offers to fill in a code that arrives by email; since iOS 17 it does, from Apple Mail. The example is now a made-up feature that claims nothing about any platform.
- 0.1.3 changes the text of the docs rule: after updating, run `/honest-docs:init`.

---

## [0.1.2] — 2026-10-08

### Changed

- **A feature doc opens with what the feature is for.** The docs rule asks for one short paragraph for someone who does not know the app — what the feature does for the user and why it has this shape, a flow's steps as the user sees them — and keeps out what a redesign would make false: UI copy, values, layout. Traps and gotchas come after it.
- 0.1.2 changes the text of the docs rule (`.claude/rules/docs.md`): after updating, run `/honest-docs:init`; until then the Stop gate blocks on `init`.

---

## [0.1.1] — 2026-10-08

### Changed

- **The Stop gate runs `honest-docs-check` itself**, on every turn that changed anything, before the project's guard; a docs failure blocks and the guard does not run. Without `guard.command` the gate now runs docs-check alone and stamps Last Updated dates instead of doing nothing. A guard that still runs docs-check keeps working, at the cost of running it twice.
- Since the gate checks all the docs on every change, `honest-docs-check` must report no problems before the plugin is turned on; `/honest-docs:init` says so.
- **A broken `.claude/honest-docs.json` is reported** instead of switching the plugin off in silence: at the end of each turn the gate says which file is wrong and that nothing was checked, and `honest-docs-check`, `honest-docs-grep` and `honest-docs-init` stop with a one-line error instead of a stack trace. Any other failure of the gate is reported the same way, with its error, and still never blocks. A `guard.command` that is not a non-empty list of strings counts as a broken config instead of being read as no guard.
- **`/honest-docs:init` works in any project on its first run.** It used to stop with an error unless `CLAUDE.md` already held both passages it maintains; now it adds the missing ones at the end of the file under `## honest-docs`, and they can be moved anywhere after that.
- The Stop gate's one-line summary counts files in English (`3 files`) instead of Polish.
- **`honest-docs-check` compares what `/honest-docs:init` wrote with what it would write now, not version numbers**, so a plugin update that changes neither the docs rule nor the `CLAUDE.md` passages blocks nothing.
- 0.1.1 changes the text of the docs rule (`.claude/rules/docs.md`): after updating, run `/honest-docs:init`; until then the Stop gate blocks on `init`.

### Fixed

- **`honest-docs-check` works in a project without `package.json` or `CLAUDE.md`.** It used to stop with a Node error; now an `npm run` a doc names is reported when there is no `package.json`, a missing `CLAUDE.md` is one problem, and the other checks still run. A symlink to nothing in a scanned folder is reported instead of stopping the check.

---

## [0.1.0] — 2026-10-07

### Added

- **A Stop gate.** At the end of every turn it runs the project's own guard on the files the turn changed and sends a failure back to the agent instead of ending the turn. It gives up after three identical failures, never blocks in plan mode or on its own errors, and does nothing until the project sets `guard.command`.
- **Last Updated dates that keep themselves.** The gate rewrites a doc's `**Last Updated:**` line from the file's modification time whenever it checks that doc.
- **A doc reminder.** When code a doc lists in its `covers:` frontmatter changes, the agent is told to re-read that doc, once per doc per session. It never blocks.
- **A session baseline,** so the gate and the reminder ignore work that was already in the tree when the session started.
- **`honest-docs-check`,** which verifies that every link, anchor, path, `npm run` script, docs-index entry and `covers:` glob in the docs still resolves, that each doc has its date line, and that what `/honest-docs:init` wrote is current. It cannot tell whether a sentence is true.
- **`honest-docs-grep`,** which lists every doc line naming a symbol, for fixing what a change made false.
- **`/honest-docs:docs-audit`,** which checks what the docs claim against the code, fixes what is false and reports it.
- **`/honest-docs:init`,** which writes the docs rule and the project's config skeleton, and keeps two short passages in `CLAUDE.md` up to date.
- **An optional instruction log** (`instructionsLog: true`) recording when rules and skills enter a session and when it writes.
- Configuration in the project's `.claude/honest-docs.json`.

### Known limitations

- Without `guard.command` the gate does nothing at all, date stamps included.
- `honest-docs-check` fails with an error in a project that has no `package.json` or no `CLAUDE.md`.
- The gate cannot tell who changed a file, so an edit the user makes in their editor mid-session counts as the agent's.

Details: `references/` in the plugin.
