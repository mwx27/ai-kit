**After a behavior change, the one mandatory doc edit is fixing what the change made false** — run
`node scripts/docs-grep.mjs <symbol>…` with every name the change renamed, removed or made behave
differently, and fix what it reports. Editing a hook, `.claude/settings.json` or a rule's `paths:` is a
behavior change like any other, and what it can make false lives in
[`agent-instructions.md`](_docs/agent-instructions.md) and
[`claude-hooks.md`](_docs/tools/claude-hooks.md). A lying doc can't wait; a missing fact can. This one line lives here
because it binds in sessions that never open a doc; everything else about writing them — one fact one
home, the do-not-write list, the worked example — is in [`.claude/rules/docs.md`](.claude/rules/docs.md).
