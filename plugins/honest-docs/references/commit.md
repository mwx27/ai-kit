# Suggesting the commit

After `/honest-docs:init` or `/honest-docs:update`, the install and the fixes it calls for go into
two commits, in this order. Only suggest them: never stage or commit, the user does.

## 1. The install

Carry out the `next:` lines about the install itself: formatting, Prettier, ESLint or tsc, and
telling the user what differs. Then suggest the install commit: every file the script reported
writing, `.claude/honest-docs/` included, and every file you changed carrying out those lines. List
the paths.

Leave the docs problems for after it is committed, though the `next:` line names them now. A file
both the install and a fix change, such as `CLAUDE.md`, then needs no partial staging.

## 2. The fixes

Once the install is committed, propose fixes and wait for the user's consent, as the `next:` line
says, for:

- the docs problems the script counted;
- text the install made untrue, such as a doc or a script in the project describing an older way to
  run the docs check.

When you made any, suggest a commit of their own, so the install stays one change to review and to
revert.

## The message

For the install, say what happened, with the versions from the script's output:

- `installed X` (init): install honest-docs X;
- `updated X → Y`: update honest-docs from X to Y;
- `updated X → X`: reinstall honest-docs X.

Read `git log --oneline -20`. The repo shows no convention when:

- it has no commits;
- it has only commits a generator made, such as "Initial commit from Create Next App", or fewer
  than 3 commits besides them;
- the titles in that log follow clearly different styles.

**A convention shows:** one suggestion, written like the titles in the log: the same shape
(Conventional Commits, a `scope:` prefix or plain sentences), case, mood, language, and the scope
the log uses for tooling, if it uses one. Never impose a format the log does not show.

**No convention shows:** two suggestions, for the user to pick the style the repo starts with: a
plain sentence ("Install honest-docs X") and a Conventional Commit ("chore: install honest-docs X").

Suggest the fixes commit the same way, in the style the user picked for the install.
