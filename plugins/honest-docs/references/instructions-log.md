# Instruction log

`<plugin_root>/hooks/instructions-log.mjs` — InstructionsLoaded + UserPromptExpansion + PostToolUse
on Edit|Write|Skill|Read.

Off by default. With `instructionsLog: true` in `.claude/honest-docs.json` it appends one line per
event to `<logDir>/instructions-<session>.log` (`logDir`, `artifacts/logs/` by default; `<session>`
is the first 8 characters of the session id), every kind into the same file so they read in the
order they happened. What this page says about Claude Code itself is marked _(documented)_ or _(observed, <month>)_, as in
[`instruction-channels.md`](instruction-channels.md).

The second column says which kind of line it is:

```
2026-09-18T08:17:45.797Z  path_glob_match  .claude/rules/code-quality.md trigger=lib/utils/cn.ts
2026-09-18T08:19:02.113Z  write:Edit  lib/utils/cn.ts
2026-09-18T08:19:30.482Z  skill:Skill  probe-skill
```

A load line carries `load_reason`, the instruction file, and the file whose access pulled it in. A
write line carries `write:` plus the tool name and the file written — the colon is what keeps a
write apart from any future `load_reason` without having to guess. A skill line does the same with
`skill:`: `skill:Skill <name>` for a Skill tool call, `skill:slash <command> source=<command_source>`
for a slash command the user typed, `skill:Read <path>` for a `Read` of a file under the project's
`.claude/skills/`. A plugin's skills live outside the project, so a `Read` of their files logs
nothing, and neither does any other `Read`. The load format is a measurement contract compared
against earlier sessions and does not change.

**A skill line is an invocation, not a load.** One probe session in September 2026 showed a Skill call on a skill
already in context getting "already loaded" back and still logging a line, a typed `/name` logging
`skill:slash` and no `skill:Skill`, and the skill descriptions every session starts with
(`skill_listing`) logging nothing. These are observations from that session, not behaviour the
Claude Code documentation states. `cat` on a `SKILL.md` logs nothing because Bash is not in the
matcher. Claude Code re-injects invoked skills after compaction _(documented)_, but the hooks documentation
has no event for it, so the log cannot see it.

Write and skill-read paths are made repo-relative POSIX; anything outside the repo is dropped, and so
is anything under `node_modules/`, `.git/` or the top folder of `stateDir` and `logDir`
(`artifacts/` by default) — the folders docs-check never walks.

The log is raw and append-only — no deduplication, no aggregation. Counting unique files, or
reloads after a compaction, is the reporting step's job, and it needs every line to do it.

**The questions it exists to answer.** A rule in `.claude/rules/` with a `paths:` glob loads on a
`Read` of a matching file and, with the tool's result, on a `Write` of one _(observed, October 2026;
in September 2026 only `Read` did)_. A session that writes a new file without reading anything in
the rule's scope first gets the rule only after that write — it misses the moment it was written
for, silently. Both events in one time-ordered file turn that into a readable fact: whether the
rule's line sits above the session's first write line, or below it, or nowhere. The second question
is whether a skill entered the session at all, and by which route — the Skill tool, a typed slash
command or a `Read` of its file.

```bash
bash <plugin_root>/scripts/check-instructions-log.sh <log> "<expected set>"
```

**The expected set is what `node <plugin_root>/scripts/context-budget.mjs <files…>` reports for the
files the session set out to touch — never the contents of `.claude/rules/`.** A rule whose globs
match nothing the session touched was never due to load, so scoring it as a miss invents the very
failure the log exists to find, and reading such a miss as evidence for a backstop line in
`CLAUDE.md` would repeat, at the reporting end, the mistake of counting a rule that isn't in scope.

**The log records the channel, not what the agent knows.** It stays silent while a rule is in
context in two cases: a rule opened by name (below) and a rule that came back with compaction
([`instruction-channels.md`](instruction-channels.md#when-each-kind-loads)).

**Known limitation: a rule opened by name.** Opening a rule file by name puts that rule's text in
context and fires no other rule's glob — the agent gets the rules it opens, and only those. Agents
open them unprompted, and a rule opened by name is not loaded again when a matching file is read
later, so the log shows no line for it _(observed, September 2026)_.

**Known limitation: the log sees Edit and Write, not Bash.** A session doing its work through
`printf >>` or `sed -i` looks exactly like a session that wrote nothing. Those sessions are out of
the sample and have to be counted separately — never quietly dropped, which is the same reason the
Stop gate takes its file list from git rather than from a record of tool calls.

**It records writes from its own `PostToolUse` entry, into its own log.** It needs the _sequence_ of
individual writes, which git cannot answer at all; a record keeping one timestamp per path,
overwritten on every rewrite, loses the one moment being measured — the first write. It writes nothing to the
shared event log ([`hooks.md`](hooks.md#event-log)): the measurement has its own.

The hook prints nothing, so the log file is its only output. Anything the hook throws is
swallowed (`<plugin_root>/hooks/io.mjs`): a diagnostic that breaks the session it measures is worse
than no diagnostic.
