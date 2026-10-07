---
name: docs-audit
description: Audit docs against the code and each other, fix what is false or forbidden, report it.
argument-hint: '[--changed | --all | <doc>…]'
disable-model-invocation: true
---

# Docs audit

Arguments: $ARGUMENTS

Read every file — doc, code, config — with `Read`, never `cat`, `sed`, `head` or `tail`, even
where the session allows them. To see the lines around a `git diff` hunk, `Read` with an
offset and limit. Search with `git grep -n --untracked` — it covers new files and skips
`node_modules/` and other ignored files — without `-A`, `-B` or `-C`, then `Read` what it finds.

## Scope

Paths below are the defaults. Where the project's `.claude/honest-docs.json` sets `docsDir`,
`undated`, `scan` or `docsAudit`, `Read` it first and use its values instead.

Docs are the Markdown files under `_docs/` (not the `undated` folders), `.claude/rules/` and
`.claude/skills/`, plus `CLAUDE.md` and `README.md`.

The plugin's reference pages linked below write `<plugin_root>` for `${CLAUDE_PLUGIN_ROOT}`.

- `<doc>…` — each named doc, every line.
- `--changed` — every doc that differs from `HEAD` or is untracked; only the changed lines
  (`git diff HEAD -U0`), a whole file if it is new. A changed line inside a code block, list, table
  or paragraph pulls in the whole block.
- `--all` — every doc, every line, one doc at a time.
- No argument — the file open in the editor, every line, if the IDE sent its path with the
  prompt and it is a doc. Anything else — no path, a code file, an unknown flag — ask which of
  the three above, and do nothing until answered.

## What is judged

A claim is one fact the text states about this repo's code. A line can carry several: a symbol
named is one claim, each thing said about it another. In a code block, every line that names code
is a claim. A list that reads as complete claims to be complete. Not judged: what `docs-check`
already verifies (link paths, anchors, backticked paths, `npm run` names; the full list and its
blind spots are in [`docs-check.md`](${CLAUDE_PLUGIN_ROOT}/references/docs-check.md)), rationale with no fact
about the code, facts about services outside the repo that the repo does not state itself (a
library is not a service: see step 2), history. A `covers:` or `paths:` glob is a claim too:
`docs-check` only proves a `covers:` glob matches something, and nothing checks `paths:` — judge
whether each names the code the doc or rule is about. When a rule loads, and why a glob that names
the wrong code fails silently, is in
[`instruction-channels.md`](${CLAUDE_PLUGIN_ROOT}/references/instruction-channels.md).

Nothing under `node_modules/` is opened — no `Read`, no `grep` of its contents — until the user
selects it in a round at the end of _Report_: it is large and costly to read, it changes with every
install, and the norm keeps library basics out of docs. Before that, only list file names and count
their lines (`ls`, `find -name`, `wc -l`).

## Order of work, per doc

1. **The norm first, in `_docs/`.** What the project's `.claude/rules/docs.md` says not to write is
   the content that goes false first, so it goes whether true or not. Delete at once only what it
   names as a kind: a prop list, a folder layout, token values, `package.json` scripts, a code
   block whose lines are copied from a repo file, design node ids, and a section on where the
   project stands (`Not implemented yet`, `What's not in scope`, a phased roadmap) unless it names
   what would change each answer. Replace it with a link to the fact's one home if it has one:
   `Read` the target first and check it states the fact; if it only points on, link where the
   fact is; if no file states it, it has no home. A target under `node_modules/` is not opened:
   the home is the library's name. The same holds for the link in table 3.
   Anything else the norm would remove — a copy of a fact with another home, library basics, what
   a component renders beyond the kinds above, what the API contract or `git log` answers, an
   empty shell, whatever is re-derivable from the source — is only proposed. It stays in the doc
   and still gets a verdict in step 2, like any other claim; a proposed deletion that is F is
   fixed like any F and keeps its row in table 3. In `.claude/rules/`, `.claude/skills/`,
   `CLAUDE.md` and `README.md` a restatement of a doc is by design; judge it like any other claim
   and check it agrees with the doc.
2. **Every remaining claim against the code.** Check every item a claim names, not the first
   few. For a list that reads as complete, find the full set in the code — the array, union,
   switch, the calls — and compare item by item: a missing item leaves nothing to search for.
   Verdict **T** with the `file:line` of every item — for a complete list, of the whole set —
   **F** with the `file:line` that shows what the code does instead, **U** with why the repo
   cannot decide it. When the repo states a fact the code does not otherwise show — an issue
   number or URL in a comment, a config value — it decides, except for what a library does
   (below): the doc agreeing is T, disagreeing is F, never U. Where the code does otherwise, the
   code wins; say so in the report.

   A claim about what a library does: judge the part about this repo's code against the code. The
   library's own behaviour is U, never T or F from memory, even where a comment in our code states
   it; where the doc and that comment disagree, say so in the evidence. In `_docs/`, if the claim
   is neither our workaround for a trap in that library nor the reason a line of ours must stay,
   it is also a proposed deletion (library basics). If it is one of those, and our code is right
   only if the library behaves as stated, and the library's source can decide it, write
   `waits on node_modules` in its action column. An upstream bug cited by an issue stays U, with
   the issue as evidence: no source reading settles it.

3. **Doc against doc.** For every symbol in a claim you changed, and every symbol in an F, run
   `honest-docs-grep <symbol>…` and check the other docs say the same.

## Before an F

- Search for what keeps the old name working: a rewrite, redirect, alias, re-export, barrel entry,
  config mapping. An old URL a rewrite still serves is not false.
- A doc names code by URL, route, event or component name as often as by path — find the file.
- One false line in a block: judge every line of the block. Rot hides a few lines from where a
  search lands.
- A step telling the reader to create something is not a claim that it exists.
- Narrower than it could be is not false: judge what the text states, not what it leaves out,
  unless it reads as complete. A label or wording you would improve on a true claim is a T.

## Fixing

- Edit with the `Edit` tool, one change per call — never a script — so each change is visible
  and logged.
- An F is replaced by the true sentence. The correction replaces the sentence — no dated notes,
  no "previously".
- A T and a U stay as they are.
- Change docs only. If the code looks wrong and the doc right, say so in the report and leave both.
- Never touch the `Last Updated` line; the guard gate sets it.
- When done, `honest-docs-check` must pass.

## Report

In the reply, per doc, four tables. The evidence in each row must let a reviewer check it without
redoing the search.

1. Every F and every U: `line | claim | verdict | evidence | action`.
2. Every deletion by the norm: `line | what went | the rule in docs.md | where the fact lives now`
   (a link, the library's name, or "nowhere — re-derivable from the source").
3. Every proposed deletion, left in the doc for the user to decide:
   `lines | what | the rule in docs.md | where the fact lives` (a link checked as step 1 says, the
   library's name for a library basic, or "nowhere — re-derivable from the source").
4. Five T spread across the doc, one per section where it has five, or all of them if fewer,
   plus every T on a list that reads as complete: `line | claim | evidence`.

After the tables, list every place where the code or a comment looks wrong and was left as it is,
with its `file:line`.

Name any part of a doc you did not get to.

Last, after the last doc's tables, if any U waits on `node_modules`, list all of them together in
the report: `doc | line | claim | why our code depends on it | files to read | their lines`, the
line counts from `wc -l`, never an estimate. A package's native source — `android/`, `ios/` and
any other directory of native code (`cpp/`, `apple/`, `common/`) — is never offered in this round,
whatever its size: the JS read names the native modules a claim depends on. The repo's own
`docsAudit.prebuildDirs` (none by default) are prebuild output and not part of this.

Then ask with the `AskUserQuestion` tool, never in prose, `multiSelect`. Each option is one
package's files, labelled with the package name; the description names the files and their total
lines from `wc -l`. Up to 4 options per question and 4 questions; when the options do not fit, ask
in prose and say why. An option left unselected is not read. Its files are not offered again in a
later round; a U that waits only on them stays U.

This first round is asked once for the whole audit, never per doc. A later round is asked only when
a file read points to another under `node_modules/` — an import, a require, a re-export, a call into
another file or into the package's native side — and a U still waits on it: list only those new
files, table then `AskUserQuestion`, the same way, also for a package already read, except that
native files may now be offered. Find them with `find -name` from the module names the JS calls;
when a name matches no file, offer the whole platform directory with its `wc -l` total. Native
options are one per platform or directory, labelled `<pkg> android`, `<pkg> ios` or `<pkg> <dir>`.
Each round needs the user's answer; before it nothing under `node_modules/` is opened, after it only
what the selected options name. After each round, judge again every U that any file read so far
speaks to, not only those that started the round — except an upstream bug cited by an issue, which
stays U (step 2). Report every verdict that changed with its `file:line`. A U that became F is fixed
as _Fixing_ says, then step 3 and `docs-check` run again for it.
