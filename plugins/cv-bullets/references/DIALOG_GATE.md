# Dialog Gate — sibling-scan & repo-selection widget mechanics

Procedural detail for **Phase 0, Question 1** (related repositories). SKILL.md owns the
*intent*; this file owns the *how* of running the scan and rendering the selection.
Read this when you reach Question 1 in a `full`-mode run.

## Step 1 — run the sibling scan first

Before asking anything, run the scan to get data-driven context:

```bash
python3 ~/.claude/skills/cv-bullets/scripts/scan_siblings.py --author "<git_author_pattern>"
```

Pass the `git_author_pattern` from `config.md` via `--author` — it's more reliable than
the script's default (`git config user.name`). The script scans the parent of the
current repo, counts your commits per sibling git repo, and categorizes them into:
contributors (≥`--min-commits`, default 1), non-contributors (git repos with 0 of your
commits — filtered out), and non-git directories (skipped).

Useful flags: `--author`, `--min-commits N`, `--parent PATH`, `--json`.

## Step 2 — show the scan summary BEFORE the widget

Always present the findings as a brief summary *before* the widget appears. The widget
only fits 3–4 options; without this summary the user can't see what was filtered out.

> "Sibling scan complete. Found {N} contributor sibling repos under {parent_path}:
> {ALL contributor repos with commits / share / last_commit, sorted by commits desc}
>
> Also found {M} non-contributor repos (0 of your commits): {names}. These will be skipped.
>
> {If non-git dirs: "Plus {K} non-git directories (skipped)."}
>
> Asking you next which to include…"

Show this even when the widget will only list a subset — the user needs the full picture
to choose well (via the widget or its built-in text escape).

## Step 3 — ask, preferring the widget when it fits

`AskUserQuestion` multi-select supports up to 4 user-defined options. It **already
includes a built-in "Type something" escape** — do NOT add your own, or you get a
duplicate. Use all 4 slots for real choices.

**All options must be additive (independently toggleable).** NEVER mix a singleton like
"only this repo" with additive options like "+ backend-service" — that's a semantic
conflict. "Only this repo" is expressed by selecting none of the options.

Always use up to 4 options if you have 4+ contributor repos — don't pre-trim because
some look redundant; that's the user's judgment. Sort options by your commit count
descending (strongest candidates first), and include contribution metrics in each label
so the user knows what they're toggling.

Branch on what the scan found:

### Case A — 0 contributor sibling repos
Skip the question. Inform the user:
> "I scanned sibling directories — found no related git repos with your contributions.
> Proceeding with single-repo analysis."

### Case B — 1–4 contributor sibling repos → widget with all of them
One option per repo, sorted by commits desc. The built-in text fallback covers repos
outside the parent directory.

Example (3 repos):
- `mobile-app` (86 commits, 1.8% share)
- `mobile-app-funnels` (12 commits, 5.9% share)
- `mobile-app-website` (4 commits, 6.6% share)

Example (exactly 4 repos): all 4 slots used for real repos; the built-in escape handles
custom input.

### Case C — 5+ contributor sibling repos → widget with top 4
Top 4 by commit count as options. **Required in the question text**: state the total
count and list the repos that didn't fit, so the user knows what they can add via the
built-in "Type something". The Step-2 summary already showed this; repeat it in the
question text to reinforce the available choices.

Example (6 repos):
- Question text: "Found 6 contributor sibling repos. Top 4 by your commit count below —
  also found: contracts (12 commits), marketing-site (8 commits). Use 'Type something' to
  add any combination beyond the top 4."
- `backend-service` (43), `ingest-lambda` (28), `landing` (67), `admin-panel` (15)

**Do not skip the "also found" mention** — without it the user can't tell what was
filtered out and may miss important repos.

## Step 4 — parse the answer

After the widget returns, read the toggled options. If the user used the built-in "Type
something", read their free-text answer for the actual repo list (it may include repos
mentioned in the question text or outside the parent directory).
