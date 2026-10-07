# Hooks

Four hooks, registered in `<plugin_root>/hooks/hooks.json`, one of them (the instruction log) on
three events. Each exists to replace something an agent has to remember with something that happens
on its own. Three of them share `<plugin_root>/core/changed-files.mjs`, so they cannot disagree about
what counts as changed. None of them counts the plugin's own folders as a change, whatever the
project's `.gitignore` says: `stateDir` and `logDir` from `.claude/honest-docs.json`,
`artifacts/claude-hooks/` and `artifacts/logs/` by default.

The instruction log has its own page: [`instructions-log.md`](instructions-log.md). What this page says about Claude Code itself is marked _(documented)_ or _(observed, <month>)_, as in
[`instruction-channels.md`](instruction-channels.md).

## `doc-reminder.mjs` — PostToolUse on Edit|Write|Bash

Names a doc to the agent when code the doc lists in its `covers:` frontmatter changes. Before it,
nothing tied a code change to the doc describing it: the docs rule loads only when the session works on a file
in the docs folder (`docsDir`, `_docs/` by default;
[`instruction-channels.md`](instruction-channels.md#when-each-kind-loads)), which a session editing
code never has to do.

**It reminds, never blocks.** Not every code change falsifies its doc, and a false block costs a
turn; the Stop gate is for what can be checked, and whether a sentence is still true cannot. The
note says which file changed and which doc covers it, asks for a `Read` of the doc and an edit only
where a sentence went false, and says it is not a request to add content. The user sees one
`systemMessage` line; several docs from one call share that line and one `additionalContext`.

**It fires on effect, by one rule for every tool.** Files change through Bash too (`sed -i`, `mv`,
`rm`), so the Bash command is never parsed: after every call the hook compares `git status` with
hashes from disk (`treeSnapshot` in the session state, written first by `session-baseline.mjs`, so
work that predates the session triggers nothing). A file counts as changed when its hash differs
from the last check — a deletion included, the strongest case of a doc outliving its code. A file
that went back to `HEAD` only moves the snapshot. A changed doc, or one already named, stays quiet
for the rest of the session (`docReminders`); the doc is judged before the code, so a call that
changes both is silent.

Like the gate, it cannot tell who changed a file: an edit in the user's editor is reported on the
next check. It writes the session state through `update()` (`<plugin_root>/core/session-state.mjs`),
which re-reads the file just before writing and merges only the fields it was given: hooks on one
event run in parallel _(documented)_, so a state read at the start of a hook may be stale by the time it writes.
Every error exits 0 in silence.

## `session-baseline.mjs` — SessionStart

Writes the dirt that was already in the working tree into the gate's `verified` map, so the gate only
ever blocks on what this session did — and the same `git status` as the doc reminder's first
snapshot, so it never fires on that dirt either. Without it, a session opened on top of unfinished
work would fail the guard on the user's own files and block the agent's first turn over something it
never touched.

**It writes the baseline exactly once per session id.** A resume, a `/clear` and a compaction all
fire SessionStart again _(documented)_, with the same session id _(observed, September 2026)_, and re-baselining there would quietly mark everything the agent had already
broken as fine. An existing state file is therefore left untouched, whatever the source.

## `stop-gate.mjs` — Stop

Runs `honest-docs-check`, then the project's guard over the changed files, and exits 2 if either
fails, which sends the failure back to the agent instead of ending the turn _(documented)_. It
replaces the instruction to remember to run the checks before finishing — a rule that has to fire in
every session and is forgotten in the one that matters.

**docs-check runs on every stop with something to check**, whatever changed: it scans all the docs,
and a code change can falsify a path or a `covers:` glob as surely as a doc edit. A failure blocks
as check `docs` and the guard does not run. Without `guard.command`, docs-check is the whole gate:
a pass logs `docs-check-only`. Because the gate checks all the docs, not only the changed ones,
`honest-docs-check` must report no problems before the plugin is turned on in a project, or every
turn blocks on docs it never touched.

### The guard contract

- `guard.command` is an argv array. The gate runs `<argv…> --changed <files…>` from the project
  root, after docs-check has passed, with `HONEST_DOCS_SCRIPTS` set to the plugin's `scripts/` folder.
- The guard need not run docs-check. One that still does (`node "$HONEST_DOCS_SCRIPTS/docs-check.mjs"`)
  runs it a second time, which costs a second run and nothing else.
- Exit 0 passes; any other exit code fails. A guard or docs-check that cannot start, or is killed
  past its timeout (150 s for the guard, 20 s for docs-check), counts as neither: the gate logs
  `error` and exits 0.
- A line `GUARD_FAIL check=<name>` in the output names the failed check; without one it is `guard`.
  With `check=docs` the gate's messages tell the agent to run `honest-docs-check`; with any other
  check, the guard command.
- The agent sees up to 12 non-empty lines of the output: those after a line containing
  `=== Error details ===` (from the start without one), up to a line starting with `GUARD_FAIL`.
- For one failure, the output must be the same run to run. The gate hashes the file list plus the
  output with colour codes, whole-second timings like `(12s)` and `<8 digits>_<6 digits>`
  timestamps stripped; anything else that varies makes two identical failures look different, and
  the gate never gives up on them.

### What it checks

**The file list comes from `git status`, not from a record of the agent's own writes** — modified,
added, untracked and rename destinations, hashed with `git hash-object` from disk rather than from
the index, since the guard reads the working tree. Anything git cannot answer (no repo, no binary, a
broken object store) returns null and the gate passes: it then knows nothing about the tree, and a
gate that knows nothing must not block.

**The session state is keyed by content, not by path** (`<stateDir>/honest-docs-<session>.json`,
shape documented in `<plugin_root>/core/session-state.mjs`). A file that passed the checks in exactly
this content sits in `verified` and is not re-checked; one the gate conceded on sits in `gaveUp`.
Both entries stop applying the moment the file changes again, which is what makes the concession
specific: it is a concession about one file in one state, not about the session.

### Last Updated stamps

**The gate is also what dates the docs.** Before the checks run, every `.md` among the files to
check that carries a `**Last Updated:**` line gets it rewritten to the file's mtime, as
`2026-10-07 14:05 CEST`, in the zone `timeZone` names (the system's by default;
`<plugin_root>/core/last-updated.mjs`), and the stamped files are rehashed so `verified` holds the
stamped content — otherwise the next stop would read its own stamp as a fresh edit and stamp again.
Riding on the gate's file list is what makes the date honest: a `sed -i` from Bash and an edit in
the user's editor count, and a doc that did not change since its last check keeps its date — mtime
alone would restamp every doc a branch switch rewrote. A `PostToolUse` hook on Edit|Write was
rejected for missing both. A doc edited and committed with no agent turn in between is not stamped
at all. A doc with no date line is never stamped, which is why docs-check requires one
([`docs-check.md`](docs-check.md)).

**The date comes from mtime, not the clock, and the write puts the mtime back** — because the
`verified` map is per session. A second session in the same repo sees the first one's stamp as a
change it never checked; stamping with the clock, the two rewrote each other's date on every stop.
With mtime both compute the same line, and the second writes nothing.

### When it lets the stop through

**It does not exit 0 on `stop_hook_active`.** That is the obvious loop protection and it disarms
the gate on the second stop, which is exactly when the agent is working through the failures.
Instead the gate hashes the failure (see the contract above), keeps the count in the session state,
and lets the _third identical_ one through — three rounds with byte-identical output is a wall, not
a gate — recording those files in `gaveUp` at their current content. Edit one of them again and it
is back under the gate.

Two more refusals to block: `permission_mode` `plan` is skipped, and every internal error exits 0.
A broken gate must never be the reason work cannot be handed back.

**Known limitation:** git cannot say who changed a file. A file the user edits in their editor
mid-session is indistinguishable from one the agent wrote, so the gate can block an agent turn over
a human's half-finished edit. That is the accepted price of covering the agent's Bash edits, which a
record of tool calls would miss entirely — and it is bounded: only edits made _after_ the session
started count, because the rest were baselined.

### Output and log

**No `statusMessage` in `hooks/hooks.json`** — it is shown while the hook runs _(documented)_, so on
every Stop, including the turns where
the hook exits in a millisecond because nothing changed. The gate is silent when it costs nothing
and prints one line naming what ran, like `docs-check, guard --changed: 3 pliki, 2.4s`, only when it
actually ran; silence is the signal.

Every invocation that can read the config appends one line to `<logDir>/guard-gate-<session>.log` —
`ran`/`skipped`, `changed=N checked=M`, milliseconds, `pass`/`fail`/`giveup`/`error` (`-` when
skipped) and the reason — so what the gate costs per turn, and how much of the tree it re-checks, is
a measurement rather than an estimate. To run it by hand, feed it the payload it expects:

```bash
echo '{"session_id":"manual","permission_mode":"default"}' \
  | CLAUDE_PROJECT_DIR="$PWD" node <plugin_root>/hooks/stop-gate.mjs
```

With no `<stateDir>/honest-docs-manual.json` in place it treats the whole dirty tree as unchecked,
which is also how you reproduce a session that started clean.

## Event log

The gate, the doc reminder, the baseline, `honest-docs-check` and `honest-docs-grep` append one JSON
line per run to `events.jsonl` in the plugin's data folder (`CLAUDE_PLUGIN_DATA`): the event, the
plugin version, the project folder's name, where the plugin is installed, and counts, outcomes and
timings — never the content of a file or a prompt. Claude Code sets that folder for hooks and what
they start _(documented)_, not for commands run from Bash _(observed, October 2026)_: `honest-docs-check` run by the gate
logs, run by the agent in Bash it does not. The instruction log never writes here.
