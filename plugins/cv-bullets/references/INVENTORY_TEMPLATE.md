# Inventory File — template & conventions

The skill persists the categorized inventory as a markdown file the user reviews
offline, uses for interview prep, and compares against future iterations.

**The inventory is a truth document, not a journey log.** Two independent axes govern a row,
and collapsing them into one is the classic failure:

- **Authorship — what's yours.** Only items that pass the Phase 2.5 blame gate get a row.
  Items the gate rejected are *not* logged here — no "considered but cut" or audit-trail
  section. Every row must be verifiably yours.
- **Selection — what shipped.** The ⭐ marks rows that became CV bullets. It is an *overlay*
  on a row, never an entry condition. Gate-surviving SOLID/BASELINE items that weren't
  chosen still get a row, just without a ⭐ — they are the swap-in pool for iteration.

So the table is deliberately broader than the "Chosen for CV" section. **If every row carries
a ⭐, the two axes have been collapsed** — the table now just duplicates "Chosen for CV" and
the swap-in pool is gone. That is the signature of the bug; rebuild from the full Phase 4
categorized list. Population order below is structured so this can't happen: rows exist
before selection does.

## When & where

- **Path**: `<cv_path>/content/data-inventories/{project-slug}-{YYYY-MM-DD}.md`
  (slug: lowercase, dashes for spaces — `mobile-app`, `web-dashboard`). If the CV dir is
  elsewhere due to sandbox limits, use the parent of wherever the CV files were found.
- **Always versioned by date** — never overwrite. If today's file already exists for
  this project, append `-2`, `-3`, …
- Create `data-inventories/` if it doesn't exist.
- **Skip entirely in `refinement` mode** — there's no fresh inventory to save.
- **Built incrementally**, not in one end-of-run write — see "Population order" below. The
  table is materialized at the end of Phase 4 (before selection), enriched in later phases,
  and its ⭐ markers updated in Phase 8 if the user iterates.

## Population order

Built across phases, not in one write. The order matters: the rows are created *before*
selection exists, so they cannot be filtered down to the chosen bullets.

- **"Repo metrics"** — after Phase 2 (git data), augmented with PR data if `gh` available.
- **"Inventory table" rows** — at the end of Phase 4: one row per gate-surviving categorized
  item, sorted FLAGSHIP→BASELINE, **Status column empty** (⭐ doesn't exist yet — selection
  is Phase 5). This is the truth snapshot, the moment that prevents the collapse above.
- **⭐ markers + "Chosen for CV"** — at Phase 5: overlay a ⭐ onto each existing row that
  became a bullet. **Never delete rows.** Non-chosen rows stay as the swap-in pool. Items
  surfaced later (Phase 6 re-scan) are appended as new rows, gated and categorized like the rest.
- **"TechStack revision"** — after Phase 6.5.
- **"Duplicate warnings"** — after Phase 6.6 Part B, only if duplicates exist (else omit).

## Template

```markdown
# CV Inventory: {Project Name}

**Date**: {YYYY-MM-DD}
**Repos analyzed**: {comma-separated list, with paths}
**Total commits found**: {N user / M total}
**Active period**: {start_date} – {end_date}

## Inventory table

{Single table sorted by category (FLAGSHIP first, then SENIOR, SOLID, BASELINE). The ⭐ in
the Status column marks rows chosen as CV bullets; rows that passed the gate but weren't
chosen stay in the table with an empty Status — that's the expected mix, not every row ⭐.}

| Status | Item | Source | Category | Evidence |
|--------|------|--------|----------|----------|
| ⭐ | Custom AI SDK v6 transport with streaming | mobile-app | FLAGSHIP | src/ai/transport.ts, 12 commits in 11.2025 |
| ⭐ | Cross-repo auth migration (header → cookie) | mobile-app, mobile-app-backend | FLAGSHIP | auth refactor across ~12 endpoint groups |
| ⭐ | RN↔WebView bridge with Clerk handoff | mobile-app, mobile-app-funnels | SENIOR | bridge in src/webview/, Clerk ticket passing |
|   | Sentry session replay + PostHog ~80 events | mobile-app | SENIOR | sentry.init in app/_layout, posthog events registry |
| ⭐ | Two-step token refresh deduplication | mobile-app | SENIOR | src/api/client.ts, actor-isolated refresh |
|   | Standard Expo Router setup | mobile-app | SOLID | app/ folder structure |
|   | Hilt dependency injection (basic) | — | BASELINE | (not used in this project) |

## TechStack revision

{Filled by Phase 6.5. One of three cases:

CASE A — kept as-is:
**Decision**: kept as-is. The existing techStack is already strong.
**Current**: "{existing techStack string}"

CASE B — replaced:
**Decision**: replaced.
**Before**: "{old techStack}"
**After**: "{new techStack}"
**Added**: {tech1 (why), tech2 (why)}
**Removed**: {tech (why)}
**Kept**: {tech list}

CASE C — new entry, no prior techStack:
**Decision**: composed from scratch.
**Composed**: "{new techStack string}"
**Rationale**: {brief selection criteria}
}

## Duplicate warnings

{Filled by Phase 6.6 Part B ONLY when cross-project duplicates are detected. Skip the
whole section if none.

- ⚠️  Bullet "Expo SDK 46 → 54 migration with breaking-change fixes" resembles
  "Migration Expo SDK 49 → 53" in another project's entry. Composition was not modified —
  your call whether to keep both, edit one, or remove one.
}

## Repo metrics

{Multi-repo: one subsection per repo. Single-repo: just one block.}

### {repo-name}
- Commits: {N user / M total} ({user_share_pct}% share)
- Active days: {N}
- Conventional commits: feat={N}, fix={N}, refactor={N}, test={N}
- feat:fix ratio: {ratio}
- Test coverage signal: {pct}% of commits touch test files
- Average commit size: {N} lines
- **PRs authored**: {total} total — {merged} merged, {closed} closed, {open} open
  {OR: "PRs: unavailable (gh not configured / not authenticated / repo not on GitHub)"}

## Chosen for CV ({count})

### Polish bullets
1. "..."

### English bullets
1. "..."

## Notes

{Optional: caveats, things noticed but not confidently categorized, suggestions for
future iterations}
```

## Column conventions

- **Status**: ⭐ for items chosen for the final bullets, empty otherwise.
- **Item**: 1-line description of the achievement/decision.
- **Source**: which repo(s) the item came from, comma-separated. **Hide this column
  entirely if only one repo was analyzed.**
- **Category**: FLAGSHIP / SENIOR / SOLID / BASELINE.
- **Evidence**: brief pointer to where it can be verified — file path, commit message,
  git-log fragment. For the user's reference (interview prep), not for the recruiter.
