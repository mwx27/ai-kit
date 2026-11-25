# Letting git see what init writes

For `/honest-docs:init` when `--preflight` lists `ignored` files and the user chose to fix them
([`preflight.md`](preflight.md)). Everything init writes, `CLAUDE.md` included, has to reach the
repo: otherwise the checks run on this machine only and nobody else gets them. Change `.gitignore`
or `.claude/settings.json` only with the user's consent.

honest-docs' own files under `.claude/` are `honest-docs/`, `honest-docs.json`, `rules/docs.md` and
`settings.json`; `honest-docs-state/` ignores itself and needs no entry.

## Steps

1. **What else is there.** For each ignored file, find the pattern from `source`. When it excludes a
   whole folder (such as `.claude/`), list what the folder holds besides honest-docs' files: for
   example `.claude/settings.local.json`, `.claude/screenshots/`, the project's own skills or
   commands. A folder git excludes is never looked into, so a `!` line for a file inside it does
   nothing; the folder itself has to be let in.
2. **Ask what stays local**, with `AskUserQuestion` (`multiSelect`), one option per item. Files
   personal to one machine usually are: `settings.local.json`, screenshots, scratch output.
3. **Propose the `.gitignore`.** Replace the folder-wide pattern with one entry per item that stays
   local, keeping the rest of the file:

   ```
   .claude/settings.local.json
   .claude/screenshots/
   ```

   A pattern naming one of honest-docs' files (such as `.claude/settings.json`) goes. A pattern in a
   file outside the repo (`core.excludesFile`, `.git/info/exclude`) is the user's own: propose
   `!<folder>/` and `!<folder>/**` in the repo's `.gitignore`, which takes precedence, followed by the
   local entries. Show the change as a diff; write it once the user agrees.
4. **`.claude/settings.json`.** When it exists and is to reach the repo, show the entries in it that
   belong to one person (`permissions`, `env`, `model`, paths on this machine) and propose moving
   them to `.claude/settings.local.json`, which Claude Code reads on top of it. Make sure the new
   `.gitignore` ignores `settings.local.json`. Move them once the user agrees.
5. **Check.** Run `--preflight` again: `ignored` must be empty before installing. If it is not, show
   what is left and go back to step 3.

## Without `AskUserQuestion`

Stop and write nothing. Show what the folder holds (step 1) and an example `.gitignore` (step 3) for
the user to complete, and say to run `/honest-docs:init` again once `.gitignore` is fixed.
