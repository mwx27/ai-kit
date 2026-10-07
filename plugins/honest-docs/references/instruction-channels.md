# Instruction channels

How instructions reach the model, why the plugin exists, and the decisions it rests on.

What this page says about Claude Code itself is marked: _(documented)_ where the Claude Code
documentation states it, _(observed, September 2026)_ where it comes from sessions watched then. An
unmarked sentence about Claude Code follows from the marked ones.

## When each kind loads

The channels differ in _when_ they enter context, and every trap below follows from that timing.

- **`CLAUDE.md`** — every session, and it survives compaction: Claude Code re-reads it from disk
  _(documented)_. A text instruction that has to reach every session has no other channel.
- **`.claude/rules/*.md` with a `paths:` glob** — when Claude uses the `Read`, `Write` or `Edit`
  tool on a matching file _(documented)_. Bash is not among them: `cat` on the same file fires
  nothing _(observed, September 2026)_. In the sessions watched then, only `Read` loaded a rule, and
  neither `Write` nor `Edit` of a matching file did _(observed, September 2026, against the
  documentation)_. One more route was seen once: when a file the session edited changes on disk
  behind it — the formatter rewriting it — the client re-reads it (`edited_text_file`) and the
  file's rule arrives on the next turn _(observed, September 2026)_. That is late by construction
  and can put a line in the log that no read of the agent's produced. **An agent that opens files
  through Bash never fires the channel**, however many matching files it reads, and the miss is
  reported nowhere. A kind of file with no analogue anywhere in the repo stays outside every read;
  that case is logically open and has never been observed. A rule opened by name is a case of its
  own ([`instructions-log.md`](instructions-log.md)).
- **Skills** — a skill the model may invoke loads when its `description` in the frontmatter matches
  the task, and one with `disable-model-invocation` loads only when the user types its `/name`
  _(documented)_; both of this plugin's skills, `/honest-docs:docs-audit` and `/honest-docs:init`,
  are such. A description that drifts from the body raises no error: the skill simply does not fire.
  With the instruction log on, a Skill call and a typed `/name` each leave a `skill:` line, and so
  does a `Read` of a file under the project's own `.claude/skills/`, so a project skill that was
  never invoked shows as an absence there and nowhere else.
- **The doc reminder** — pushed at the moment of a change, not pulled by a read: after an Edit,
  Write or Bash call that changed a file some doc lists in `covers:`, a `PostToolUse` hook names
  that doc to the agent, once per doc per session ([`hooks.md`](hooks.md)). It carries the doc's
  name, not its text — the doc itself arrives only when the agent opens it.
- **Compaction** — Claude Code re-reads up to five of the files the session read or edited, most
  recently modified first, and summarizes path-scoped rules away with the rest of the conversation
  _(documented)_. In the sessions watched in September 2026, rule files the session had read came
  back as file attachments _(observed, against the documentation)_, so whether a rule returns after
  compaction is not something to rely on. The instruction log saw none of them come back
  _(observed, September 2026)_: restoring a read file is not a rule load.
- **`@import`** — buys no context back. An imported file is loaded at launch alongside the
  `CLAUDE.md` that imports it _(documented)_; the import splits the file, not the context.

## Why it exists

Documentation that has grown, contradicts itself and says false things about the code costs more
than none: the agent keeps reading it and acts on it. That is where the instruction layers of
earlier apps ended up after a few hundred commits, and this plugin is built to keep a project's docs
worth reading as it matures instead. Everything else here — channels, decisions — serves that, by
four mechanisms:

- **Less surface to keep true.** What nobody reads rots, so only as much stays as can be held true
  (the docs rule `/honest-docs:init` writes, from `<plugin_root>/templates/docs.md`: write what the
  code cannot carry).
- **Mechanical checks over prose.** A check needs no one to remember it: the Stop gate blocks a turn
  whose changes fail the project's guard, and a guard that runs `honest-docs-check` fails while a
  link, path or script a doc names does not resolve ([`docs-check.md`](docs-check.md)).
- **An instruction that arrives.** A rule that never loads is indistinguishable from one that does
  not exist, and nobody sees the moment it stops matching the code ([above](#when-each-kind-loads)).
- **A code change that points at its doc.** `covers:` ties a doc to the code it describes, and a
  hook names the doc when that code changes ([`hooks.md`](hooks.md)). The reverse runs by hand:
  `honest-docs-grep` lists every line of the docs and rules that names a given symbol, and the docs
  policy `/honest-docs:init` puts in `CLAUDE.md` has the agent run it after a behavior change.

**Delivery is not truth.** A rule can arrive in every session and be false; none of the four
mechanisms checks what a sentence claims about the code. The last one only chooses the moment
someone looks — the judgement is still a reader's: a person's, or an agent's running
`/honest-docs:docs-audit`.

## Decisions

**The Stop gate blocks rather than reports** — exit 2 from the Stop hook, which keeps Claude from
stopping _(documented)_ ([`hooks.md`](hooks.md#stop-gatemjs--stop)). The cost is asymmetric: a gate that fires when it
needn't costs seconds of one turn, a gate that is missing costs a green commit with a broken tree
behind it. The escape hatch, for when the gate itself is what's wrong, is the give-up after three
identical failures; removing `guard.command` from `.claude/honest-docs.json` takes the project's
guard out but leaves docs-check. Only disabling the plugin turns the gate off, and every other hook
with it.

**The gate reads the changed-file list from git, not from a record of the agent's own writes.** The
agent also changes files through Bash (`printf >>`, `sed -i`, `patch`), which a `PostToolUse` hook
on Edit|Write never sees — so a tool-call record's picture of the turn is partial, and a gate fed
from it waves through exactly the turns that did their work that way.

**Measurement precedes removing an instruction, not building a safeguard.** Where the cost is
asymmetric you build first and measure later, if at all; it is taking something away that has to be
paid for with evidence.

**`/honest-docs:init` puts one line in `CLAUDE.md` ordering reads through `Read`** — the backstop
for the path-scoped channel, closing the Bash hole. The evidence for it is thinner than a removal
would need, so the `PreToolUse` hook that would enforce the line is not built. The line is kept on
the rule above: one line of context against a channel that fails silently. **The wording is the one
measured in September 2026.** Rephrasing or translating it is a new measurement, not an edit. The
choice of tool is the agent's working style, not only the environment's push _(observed, September
2026)_.

**The backstop must not forbid `grep` or `find`.** On macOS, Linux and WSL, Claude Code leaves `Grep`
and `Glob` out of the default tool set and Claude searches with `find` and `grep` through Bash
_(documented)_, so they are the only search there is. A `grep` with context lines (`-A`, `-C`) reads file content without a `Read`,
and nothing has measured how often that replaces opening the file.

**Why `traps and gotchas first` has a length threshold** (the docs rule holds it). A doc opened
against a concrete task is often abandoned halfway, so on a long page the sections that justify the
doc have to sit above the cut. On a short one there is no cut to sit above, and the ordering that
reads best wins.
