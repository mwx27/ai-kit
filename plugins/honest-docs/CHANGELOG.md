# Changelog

All notable changes to the `honest-docs` plugin are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). It stays in the `0.x` range until the interface settles.

---

## [Unreleased]

### Changed

- **The Stop gate runs `honest-docs-check` itself**, on every turn that changed anything, before the project's guard; a docs failure blocks and the guard does not run. Without `guard.command` the gate now runs docs-check alone and stamps Last Updated dates instead of doing nothing. A guard that still runs docs-check keeps working, at the cost of running it twice.
- Since the gate checks all the docs on every change, `honest-docs-check` must report no problems before the plugin is turned on; `/honest-docs:init` says so.
- **A broken `.claude/honest-docs.json` is reported** instead of switching the plugin off in silence: at the end of each turn the gate says which file is wrong and that nothing was checked, and `honest-docs-check`, `honest-docs-grep` and `honest-docs-init` stop with a one-line error instead of a stack trace. Any other failure of the gate is reported the same way, with its error, and still never blocks. A `guard.command` that is not a non-empty list of strings counts as a broken config instead of being read as no guard.
- **`/honest-docs:init` works in any project on its first run.** It used to stop with an error unless `CLAUDE.md` already held both passages it maintains; now it adds the missing ones at the end of the file under `## honest-docs`, and they can be moved anywhere after that.

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
