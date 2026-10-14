---
name: ask
description: Ask a question about another local repository (its code, API, conventions), answered by a read-only Claude session run inside it. Use when the task needs facts from a sibling repo the user registered with ask-repo (`ask-repo --list` shows them), or when the user says "ask <alias>". Each question costs a full Claude session, so never ask speculatively.
argument-hint: '<alias> "question"'
allowed-tools: Bash(ask-repo:*)
---

# Ask another repo

Arguments: $ARGUMENTS

1. Run `ask-repo --list`. If the repo the question is about has no alias, ask the user for its
   path and a name, then run `ask-repo --add <alias> <path>`.
2. Look for the answer first in what is already here: this repo, and earlier answers in
   `artifacts/ask-repo/<alias>/*.md` at the project root.
3. Ask in Bash with `timeout: 600000`, since an answer can take minutes. One topic per session:
   - the first question on a topic: `ask-repo -n <topic> <alias> "question"`
   - every follow-up: `ask-repo -c <alias> <topic> "question"`. Never start a new session on a
     topic that already has one.
   - Add `--git` only when the answer needs git history (log, blame, diffs).
4. The answer is the other repo's view. Before acting on what it says about this repo's code,
   check that here.

`ask-repo --help` lists every option.
