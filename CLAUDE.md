# CLAUDE.md — maintaining this repo

A personal plugin marketplace. Each plugin lives under `plugins/<name>/` (manifest in
`.claude-plugin/plugin.json`, registered in `.claude-plugin/marketplace.json`); user-facing
intro and install steps live in `README.md`. The notes below are conventions for *editing*
skills here that aren't obvious from the tree — they deliberately don't restate the README
or the global git rules in `~/.claude/CLAUDE.md`.

## Keep `SKILL.md` lean

`SKILL.md` is auto-loaded into context on every invocation, so long always-on prose
measurably degrades behavior (the cv-bullets dialog gate got under-executed once its
`SKILL.md` grew too long). Put bulky procedural detail — templates, widget mechanics,
long examples — into `references/*.md` that the workflow points to on demand, and keep
`SKILL.md` to the workflow skeleton. Link every `references/*.md` directly from `SKILL.md`,
not from another reference — Claude reads nested files only partially.

The working directory at runtime is the user's project, and a marketplace install lives in
Claude Code's plugin cache, so nothing is reached by a path relative to the skill:

- **A skill's own files:** `${CLAUDE_SKILL_DIR}/…` in `SKILL.md`, `<skill_dir>/…` in
  `references/*.md`, with `SKILL.md` saying what `<skill_dir>` means.
- **Files shared by a plugin's skills** (`plugins/<name>/references/`):
  `${CLAUDE_PLUGIN_ROOT}/references/…` in `SKILL.md`, still linked directly from it;
  `<plugin_root>/…` in `references/*.md`, with `SKILL.md` saying what `<plugin_root>` means.
- **Commands:** what a skill tells the agent to run in Bash is a name from the plugin's
  `bin/`, which Claude Code documents on the Bash tool's PATH while the plugin is enabled.
  Hooks call `${CLAUDE_PLUGIN_ROOT}/…`: the docs say nothing about `bin/` on a hook's PATH.

Claude Code documents `${CLAUDE_SKILL_DIR}` substitution only for `SKILL.md`, and
`${CLAUDE_PLUGIN_ROOT}` in skill content, not in the files a skill reads.

## One home per fact across the doc layers

A skill's docs form layers — `SKILL.md` (skeleton), `references/*.md` (operational detail),
`CHANGELOG.md` (version delta), `README.md` (human overview). A given fact — a threshold, a
flag, a caveat — gets **one load-bearing home** (usually the relevant `references/*.md`);
the other layers point to it, not copy it. Before adding detail to one layer, check it
isn't already carried by another. Default to the shortest prose that conveys the point —
verbose additions get trimmed in review, so write them lean the first time. A known
limitation's living home is its `references/*.md`; `README.md` carries a general,
jargon-free version for humans, and `CHANGELOG.md` a version-scoped note.

## Reliability comes from structure, not emphasis

When an instruction gets ignored or two rules get collapsed into one, the fix is almost never
louder or longer prose — long always-on prose measurably degrades behavior (see "Keep
`SKILL.md` lean"). Reorder the workflow so the wrong state can't exist — build an artifact
*before* the later step that would bias it — or force a verifiable intermediate output. Match
instruction specificity to the step's fragility: a prescriptive sequence for fragile,
error-prone steps; high-level direction where many paths succeed. General skill-authoring
guidance (conciseness, progressive disclosure, evals-first, degrees of freedom) lives upstream
at <https://platform.claude.com/docs/en/docs/agents-and-tools/agent-skills/best-practices>;
this file carries only the repo-specific deltas.

## Versioning

SemVer, `0.x` until an interface settles. Each plugin owns one `CHANGELOG.md`
([Keep a Changelog](https://keepachangelog.com/)), shared by its skills. A version bump
changes `version` in `.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry. Only a
skill that states its own version (cv-bullets) also carries a `Current version:` footer in
its `SKILL.md`, bumped with them; code that needs the version reads `plugin.json`.

## No personal data in skills

Paths and identity come from a git-ignored `config.md` (template: `config.md.example`);
never hard-code a CV path, name, or author pattern into a skill. The user's actual CV is
not in this repo.
