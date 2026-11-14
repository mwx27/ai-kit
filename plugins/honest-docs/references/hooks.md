# Hooks

Each hook replaces something an agent would have to remember with something that happens on its
own. What this page says about Claude Code itself is marked _(documented)_ or _(observed, <month>)_,
as in [`instruction-channels.md`](instruction-channels.md). The instruction log has its own page:
[`instructions-log.md`](instructions-log.md).

## Where they live

The checks run from a copy in the project, `.claude/honest-docs/`, which `/honest-docs:init` writes
and `/honest-docs:update` brings to the plugin's version. Both merge the copy's hooks into the
project's `.claude/settings.json`, each as `node ${CLAUDE_PROJECT_DIR}/.claude/honest-docs/hooks/<x>.mjs`,
and leave every other hook and key there as it is; the list of events, matchers and timeouts is
`HOOK_SET` in `.claude/honest-docs/core/settings-merge.mjs`. The hooks therefore run for whoever
opens the project, with or without the plugin, at the version committed with the tree. Hooks
written into the settings mid-session normally take effect at once _(documented)_.

| Event                     | Script                | Does                                                    |
| ------------------------- | --------------------- | ------------------------------------------------------- |
| SessionStart              | `session-start.mjs`   | takes the start set ([below](#sessionstart-the-start-set)) |
| PreToolUse (Bash)         | `pre-tool.mjs`        | stores the tree before the call                         |
| PostToolUse (Edit, Write, NotebookEdit, Bash), PostToolUseFailure (Bash) | `post-tool.mjs` | attributes the changed paths, then runs the doc reminder |
| Stop                      | `stop-gate.mjs`       | the gate                                                |
| InstructionsLoaded, UserPromptExpansion, PostToolUse (Edit, Write, Skill, Read) | `instructions-log.mjs` | the instruction log, when the config turns it on |

The plugin keeps one hook of its own, SessionStart in `<plugin_root>/hooks/hooks.json`
(`<plugin_root>/core/notify.mjs`). It compares the copy with the plugin and tells the user, in a
`systemMessage`, which the user sees and the model does not _(documented)_:

| The project                                 | The notice                         |
| ------------------------------------------- | ---------------------------------- |
| no `.claude/honest-docs.json`               | none: it does not use honest-docs  |
| a config, no `.claude/honest-docs/manifest.json` | run `/honest-docs:init`       |
| a copy older than the plugin                | run `/honest-docs:update`          |
| a copy newer than the plugin                | run `claude plugin update`         |
| the same version                            | none                               |

A config or manifest it cannot read is named in the notice instead.

**No `statusMessage` on any hook**: it is shown while the hook runs _(documented)_, so on every
Stop, including those where nothing changed and the gate exits in a millisecond. The gate prints
one line only when it ran.

## The project root

A hook acts on the git repository holding its input's `cwd`, not on `CLAUDE_PROJECT_DIR`: that stays
at the folder the session started in, while `cwd` is the worktree root in a worktree session and
follows a `cd` _(documented)_. Without git it falls back to `CLAUDE_PROJECT_DIR`. The copy's hooks
do nothing where that root has no `.claude/honest-docs/manifest.json`, so a `cd` into a sibling repo
without a copy leaves it alone.

The settings, and so the code that runs, are the main checkout's. In a worktree whose copy is
another version, the gate checks nothing that turn and says so in a `systemMessage`.

## Attribution

The hooks act on what this session's tool calls changed, not on everything that changed in the
tree. Each changed path is appended to the session's `attributed.jsonl`
(`.claude/honest-docs/core/attribution.mjs`):

- **Edit, Write, NotebookEdit** by the path the call names (`file_path`, else `notebook_path`).
- **Bash** by effect, since its command is never parsed: PreToolUse stores the dirty tree and its
  hashes under the call's `tool_use_id`, and PostToolUse or PostToolUseFailure compares the tree
  with it. Every path whose state moved in between is the call's.
- **Deletions** count, by either route. A deleted file is the strongest case of a doc outliving its
  code.

Not attributed: paths outside the root, ignored by git, or in honest-docs' own folders (`stateDir`,
`logDir` and the copy); a Bash call with no stored tree (hooks added mid-call), which records
nothing; and a path that went from dirty back to `HEAD` with its content unchanged, a commit rather
than a change. Doubtful cases go to not attributing: a false block costs more than a gap. A stored
tree with no Post is removed after 15 minutes, at the next Stop.

A subagent's hooks carry the main session's `session_id`, so its changes are the session's
_(observed, November 2026)_.

## The doc reminder

Names a doc to the agent when code the doc lists in its `covers:` frontmatter changes, on the paths
a tool call was just attributed. Before it, nothing tied a code change to the doc describing it:
the docs rule loads only when the session works on a file in the docs folder (`docsDir`, `_docs/`
by default; [`instruction-channels.md`](instruction-channels.md#when-each-kind-loads)), which a
session editing code never has to do.

**It reminds, never blocks.** Not every code change falsifies its doc, and whether a sentence is
still true cannot be checked. The note names the changed file and the doc covering it, asks for a
`Read` of the doc and an edit only where a sentence went false, and says it is not a request to add
content. The user sees one `systemMessage` line; several docs from one call share it. A doc the
session changed, or one already named, stays quiet for the rest of the session; the doc is judged
before the code, so a call changing both is silent.

The first time a reminder names a doc, or an Edit or Write touches one, that has problems in the
start set, the agent is told how many, as a count only: it is context, not a request to fix them.

Hooks on one event run in parallel _(documented)_, so the reminder writes the session state through
`update()` (`.claude/honest-docs/core/session-state.mjs`), which re-reads it just before writing.

## SessionStart: the start set

Runs `docs-check --json` and stores its problems in the session's state as the start set: the
problems that were there before the session did anything. A problem is keyed by check, doc and
message, without the line, so lines moving above it leave it alone; the same problem twice in a doc
is two occurrences (`.claude/honest-docs/core/problems.mjs`).

**It is taken once per session id.** A resume, a `/clear` and a compaction fire SessionStart again
_(documented)_, with the same session id _(observed, September 2026)_; after `--resume` the session
keeps its folder, its start set and its attributions _(observed, November 2026)_. Taking it again
would turn what the session already broke into problems from before it.

**It tells the model how many there are**, every time it fires, since the earlier context may be
gone. Its plain stdout goes to the model's context _(documented)_:

```
honest-docs: 8 docs problems in this repo (not blocking); list them with node .claude/honest-docs/scripts/docs-check.mjs
```

With no problems it prints nothing. A docs-check that fails or runs past 12 s leaves no start set.

## The Stop gate

Runs docs-check, then the project's guard on the session's changed files, and exits 2 when either
fails on the session's own work, which sends the failure back to the agent instead of ending the
turn _(documented)_. It replaces the instruction to remember to run the checks before finishing — a
rule that has to fire in every session and is forgotten in the one that matters.

### What blocks

**Only a docs problem that is new and that this session caused.** New: past its count in the start
set. Caused: its doc, or a path in its `related` field ([`docs-check.md`](docs-check.md#the---json-output)),
is among the session's attributed paths, deletions included. An attributed
`.claude/honest-docs.json` makes every new problem caused, since it sets what is scanned and
accepted. A `covers` glob that matches no file is caused when the session deleted a file matching
it; a file that merely stopped matching is not seen.

- New problems the session did not cause go to the user in the `systemMessage`
  (`1 new docs problem not from this session`), not to the agent, so it does not set about fixing
  another session's work.
- Nothing attributed, nothing run: a session that only reads, beside one that writes, is never
  blocked, and neither is one whose user edits in an editor files it never touched.
- No start set — hooks added mid-session, a first install, a SessionStart docs-check that failed:
  the first Stop takes one from the current problems and does not block on the docs.
- A start set taken by another version of the copy (`/honest-docs:update` mid-session): the Stop
  takes a new one, since a stricter check is not the session making things worse.

docs-check runs on the whole docs tree, since a code change can break a doc. A blocking docs problem
stops the gate there, as check `docs`, and the guard does not run. Without `guard.command`,
docs-check is the whole gate.

The paths checked are the attributed ones, minus those that already passed, or were given up on, in
this exact content. The session state is keyed by content (`verified` and `gaveUp`, shape in
`.claude/honest-docs/core/session-state.mjs`): an entry stops applying the moment the file changes
again. Without git the gate knows nothing about the tree and does not block.

### The guard contract

- `guard.command` is an argv array. The gate runs `<argv…> --changed <files…>` from the project
  root, with the files it checks that are still on disk, and `HONEST_DOCS_SCRIPTS` set to the copy's
  `scripts/` folder. A turn that only deleted files does not run it.
- The guard need not run docs-check. One that still does
  (`node "$HONEST_DOCS_SCRIPTS/docs-check.mjs"`) runs it a second time, which costs time and
  nothing else — and blocks on every problem in the repo, which the gate itself does not.
- Exit 0 passes; any other exit code fails, unless the guard says it could not check (`GUARD_ERROR`,
  below). A guard or docs-check that cannot start, or is killed past its timeout (150 s for the
  guard, 20 s for docs-check), blocks nothing: the stop goes through with a `systemMessage` or a
  logged `error`.
- A line `GUARD_FAIL check=<name>` in the output names the failed check; without one it is `guard`.
- A guard that could not check — a simulator that is not running, a service that is down — exits
  non-zero and prints `GUARD_ERROR reason=<text>`. The gate lets the stop through, does not record
  the files as verified, so the next stop checks them again, and tells the user why in a
  `systemMessage`. Claude hears from a Stop hook that exits 0 only through `decision: "block"` or
  `additionalContext`, which the gate does not send _(documented)_, so the agent is not sent to fix
  the environment. A `GUARD_FAIL` line in the same output wins and blocks.
- The agent sees up to 12 non-empty lines of the output: those after a line containing
  `=== Error details ===` (from the start without one), up to a line starting with `GUARD_FAIL`.
- For one failure, the output must be the same run to run. The gate hashes the file list plus the
  output with colour codes, whole-second timings like `(12s)` and `<8 digits>_<6 digits>`
  timestamps stripped; anything else that varies makes two identical failures look different, and
  the gate never gives up on them.

### Last Updated stamps

**The gate is also what dates the docs.** Before the checks run, each attributed doc it is about to
check that carries a `**Last Updated:**` line gets it rewritten to the file's mtime, as
`2026-10-07 14:05 CEST`, in the zone `timeZone` names (the system's by default;
`.claude/honest-docs/core/last-updated.mjs`), and is rehashed, so `verified` holds the stamped
content and the next stop does not read the stamp as a fresh edit. A doc only the user changed is
not stamped, nor one edited and committed with no agent turn in between. A doc with no date line is
never stamped, which is why docs-check requires one ([`docs-check.md`](docs-check.md)) and
`/honest-docs:init` adds one, dated by the doc's last commit, to each doc that lacks it.

**The date comes from mtime, not the clock, and the write puts the mtime back**, because `verified`
is per session: two sessions that both stamp a doc compute the same line, and the second writes
nothing. Stamping with the clock, they rewrote each other's date on every stop.

### When it lets the stop through

**It does not exit 0 on `stop_hook_active`.** That obvious loop protection disarms the gate on the
second stop, exactly when the agent is working through the failures. Instead the gate counts
identical failures (the contract above) and lets the _third_ through, recording those files in
`gaveUp` at their current content; edit one again and it is back under the gate. The cost: a docs
problem let through this way is not in this session's start set, but it is in the next session's,
where it no longer blocks. The SessionStart line still counts it.

`permission_mode` `plan` is skipped, and so is everything when the gate itself fails: **every
internal error is reported, and none blocks.** The stop goes through with a `systemMessage` saying
the gate checked nothing this turn, since a silent failure would pass for a gate that ran. A
`.claude/honest-docs.json` that is not valid JSON or not an object gets a message naming the file
and the error, and reason `config-error` in the event log. So does a `guard` that is not an object,
or a `guard.command` that is not a non-empty array of strings: read as no guard, it would switch the
project's checks off unseen. The other values are not validated; a wrong type (`"docsDir": 5`)
surfaces as `the Stop gate failed (…)`, logged as `internal-error`. The other hooks stay silent on a
broken config and only log it, so the user hears it once per turn; `docs-check.mjs`, `docs-grep.mjs`
and the install script exit 2 with one line saying the same.

### Its log

Every invocation that can read the config appends one line to `<logDir>/guard-gate-<session>.log`:
`ran`/`skipped`, `changed=N checked=M`, milliseconds, `pass`/`fail`/`giveup`/`unchecked`/`error`
(`-` when skipped) and the reason, so what the gate costs per turn is a measurement rather than an
estimate. `changed` counts the attributed paths. To run it by hand, attribute a path to a session
and feed the gate its payload; the first run takes the start set:

```bash
mkdir -p <stateDir>/honest-docs/manual
echo '{"path":"<doc>"}' >> <stateDir>/honest-docs/manual/attributed.jsonl
echo "{\"session_id\":\"manual\",\"cwd\":\"$PWD\"}" | node .claude/honest-docs/hooks/stop-gate.mjs
```

## Limits

- **Attribution is per file.** Once the session has changed a file, every later change to it
  counts as the session's, a hand edit in an editor or another session's included. Editing by hand
  the files an agent is editing, or running two agents on the same files, is a conflict the user
  sets up; honest-docs does not settle it.
- **A Bash call's window attributes every change in it**, another session's too.
- **A Bash write in the background is not attributed.** With `run_in_background`, PostToolUse
  arrives when the command starts, so what the process writes afterwards falls outside the window
  _(observed, November 2026)_.
- **`git pull` and `git checkout` attribute nothing**: on a clean tree they change no dirty path.
  `git stash pop` attributes everything it brings back.
- **NotebookEdit's input has not been seen live**; the path is read from `file_path` or
  `notebook_path`.
- **The project's guard checks what it checks.** A guard running `tsc` on the whole project can
  block one session on another's unfinished work: that is for the guard to filter, by the files
  after `--changed`.

## Event log

The hooks, and what they start (docs-check, the guard), append one JSON line per run to
`<logDir>/events.jsonl` in the project: the event, the copy's version, the project folder's name,
where the running code is, and counts, outcomes and timings — never the content of a file or a
prompt. A script run from a terminal, CI or the agent's Bash writes nothing: only a process a hook
started does (`.claude/honest-docs/core/log.mjs`). The instruction log never writes here.
