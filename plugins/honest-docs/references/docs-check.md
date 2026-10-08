# Docs check

`honest-docs-check` (`<plugin_root>/scripts/docs-check.mjs`) answers one question about every
Markdown file the config's `scan` names — by default the docs folder (`docsDir`, `_docs/`),
`.claude/rules/`, `.claude/skills/`, `CLAUDE.md` and `README.md`: **does everything this text points
at still exist?** Six checks ask that, a seventh, `updated`, that every doc carries the date line the
Stop gate rewrites, and an eighth, `init`, that what `/honest-docs:init` wrote is current — file
reads, regexes and two git calls, no dependencies, well under a second. The Stop gate runs it only
through the project's guard ([`hooks.md`](hooks.md#the-guard-contract)).

The rule files are in scope for the same reason the docs are: they carry links and paths, they are
read as instructions, and a rule pointing at a file that moved is worse than a doc doing it — the
reader acts on it.

The rule half of `index` reads only the Rules section of the index file: other sections link rules
as pointers, and a rule linked only there is still missing from the index.

| Check     | What must hold                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `links`   | every relative markdown link resolves to a file                                                                                                                                                                                                  |
| `anchors` | every `#anchor` into a scanned page matches a heading in that page                                                                                                                                                                               |
| `paths`   | every backticked repo path exists on disk                                                                                                                                                                                                        |
| `scripts` | every `npm run X` names a script in `package.json`                                                                                                                                                                                               |
| `index`   | the docs index in the index file (`index.file`, `CLAUDE.md` by default) and the `index.groups` folders under the docs folder (`features` and `tools`) agree, both ways; so do its Rules section (`index.rulesHeading`, `Rules`) and `.claude/rules/` |
| `covers`  | every glob in a doc's `covers:` frontmatter matches a file on disk that git tracks or would track, and the key holds one                                                                                                                         |
| `updated` | every page in the docs folder outside the `undated` folders (none by default) has exactly one line starting with `**Last Updated:**`                                                                                                             |
| `init`    | `.claude/rules/docs.md` exists and, its last line aside, reads as `/honest-docs:init` would write it now; the index file holds the current version of each fragment `/honest-docs:init` writes — the `Read` line and the docs policy — exactly once |

`updated` exists because the gate only rewrites a date line that is already there
([`hooks.md`](hooks.md#last-updated-stamps)), and the docs rule asking for one reaches a new doc
only after `Write` has created it _(observed, October 2026)_. Without the check a new doc could
stay undated for good.

`init` exists because the plugin is updated outside the project, and what it wrote into the project
is not. It compares text, never version numbers: the rule's last line, the stamp naming the plugin
version that wrote it, is left out of the comparison, so an update that changes neither the rule nor
a fragment reports nothing. Whitespace is ignored in the rule as in the fragments, so the project's
formatter may rewrap it. A fragment's current version is the newest file in
`<plugin_root>/templates/fragments/<name>/` not above the plugin's version, and it counts as present
when its words appear in order with any whitespace between them, so a rewrap passes and a changed
word does not. Every problem it reports names the rule or the fragment that differs, and all but a
fragment present twice say to run `/honest-docs:init`.

`covers` asks git for tracked plus untracked-but-not-ignored files, so a doc written with a feature
not yet added passes, and drops what is gone from disk, so a doc outliving its deleted code fails
before the deletion is staged. A `covers:` key the parser reads no glob from — CRLF line endings,
`covers: []`, a one-line value — is an error too: the parser reads only a block list, and a key it
cannot read would otherwise pass as a doc that covers nothing. That part is a plain file read;
without git only the matching is skipped, with one line of output. The globs are root-anchored, read
by the same `<plugin_root>/core/doc-covers.mjs` as the doc reminder
([`hooks.md`](hooks.md#doc-remindermjs--posttooluse-on-editwritebash)).

A project without `package.json` gets every `npm run` its docs name reported under `scripts`, as
`no package.json`, and nothing when they name none. Without the index file, `index` reports that
file as not found and nothing else, `init` reports its fragments missing, and the other checks run
as usual. A symlink to nothing in a scanned folder is reported under `links`.

## The two lists in the config

`absentByDesign` holds paths a doc may name that a clean checkout does not have: generated, vendored
per project or deliberately hypothetical. `absentScripts` does the same for an `npm run` a doc names
while explaining why it does not exist. Both are empty by default. An entry in either is a statement
that the absence is intended — that is the point of writing them down rather than inferring.

## Traps it already encodes

Both of these produced false reports before they were handled, and both will bite a rewrite:

- **Anchor slugs keep the space where punctuation was.** GitHub deletes punctuation instead of
  replacing it, so `` ## Errors — `ApiError` `` becomes `#errors--apierror`, with two hyphens.
  Collapsing whitespace runs reports live anchors as broken.
- **Links to paths with parentheses use the angle-bracket form** — `[x](<../app/(tabs)/index.tsx>)`,
  which is also what prettier writes. A pattern that stops at the first `)` reports those as missing.

## What it deliberately does not check

Bare filenames (`store.ts`, `PascalCase.tsx`) are conventions or folder-relative prose, and checking
them produced sixty false reports against a clean tree. Only tokens holding a `/` whose first
segment exists at the root are treated as paths, plus the root-level names listed in `rootFiles`
(empty by default): a doc naming a root file that was never there is caught only when that name is
on the list. One consequence: a bare `types/` in a table cell is not checked, because a single
segment could belong to any folder.

Environment variable names were checked in an early version and dropped: code constants and worked
examples are indistinguishable from real keys, and a check that cries wolf gets neutered.

## What it cannot catch

It verifies that references resolve, never that a sentence is true: a doc claiming a filter matches
on message text when the code uses a predicate passes every check here. Semantic drift needs a
reader — a person, or an agent running `/honest-docs:docs-audit`.
