# Public-safe inventory — redaction rules, format & home

The skill builds a **private** inventory (`references/INVENTORY_TEMPLATE.md`) full of
evidence that must not go outward: client metrics, contribution share, file paths, commit
hashes, teammate attribution, candid construction notes. Outward-facing consumers (e.g. a
recruiter-facing CV chatbot) need a redacted copy. When that redaction is a manual step
living outside the repo it **drifts** — the public copy lags the private one and goes stale.

So the skill also emits a **public-safe sibling** of the inventory, derived from the same
in-memory data and regenerated whenever the private one changes. It is a **review-it-first
draft, not a verified-safe file** — see "Safety stamp" below.

## When it runs

- Derive it from the inventory data **already in memory** (tiers exist after Phase 4; the
  polished PL/EN bullets after composition/review). **Never re-scan the repo** to build it.
- Emit it in **Phase 7** after the CV write, and **refresh it in Phase 8** whenever iteration
  changes the bullets or tiers — keeping it in sync is the whole point (it kills the drift).
- **Default-on** (single user, no opt-in). **Skip in `refinement` mode** — there's no fresh
  inventory there.

## Strip — never appears in the public file

- **NDA / client-confidential product details.**
- **Security-sensitive anecdotes** (e.g. a specific vulnerability the user patched).
- **Client repo internals:** commit counts, contribution share %, local repo paths, commit
  hashes, sibling-repo names + their counts.
- **Teammate names / per-person attribution** (line or commit splits). Render co-authored
  work as **"co-built"** and majority ownership as **"primary author"** — **never name another
  person.**
- **Construction meta-notes:** the Notes / Duplicate warnings / Repo metrics / TechStack
  revision / identity-rollup / before-vs-after / authorship-gate-dropped sections, and any
  bullet-selection rationale.

## Keep

- **Technical substance** — architecture, library / pattern / symbol names. These describe the
  engineer's work, not client secrets.
- **The tier categorization** (Flagship / Senior / Solid / Baseline) — minus the
  evidence/metric columns.
- **The polished PL/EN bullets.**
- **Role claims that are facts, not metrics** — e.g. "sole RN engineer", "primary author".

## Output format

Sanitized **prose, not a table.** Detail tapers with tier significance — every item still
carries information; lower tiers are shorter, not emptier. The bold headline is visual weight
matched to importance, not a marker of "has substance".

```markdown
# <Project>

<1-paragraph intro: what it is, the user's role + period, ownership framing
("primary author" / "co-built"), and a line stating the tier labels are the
user's own assessment of significance.>

## Flagship / Senior
- **<headline>** — <full explanation: the how, the decisions>.

## Solid
- <one concise line, substance inline, no bold headline>

## Baseline
- <terse one-liner — the what, no elaboration>

## CV bullets
**Polish**
1. …

**English**
1. …
```

- This template is the **canonical format** — it must stand on its own, since the first
  project has no existing public files to mirror.
- If one or more public inventories already exist, stay consistent with them (ordering,
  heading style, bullet voice). If this is the first, the template is the sole spec.
- **Omit any tier with no surviving items; never pad an empty tier with filler.**
- The tier sections and `## CV bullets` **intentionally overlap**: the bullets are the polished
  one-line forms of the same achievements. That repetition is expected, not a duplicate to remove.

## Path / naming

Sibling of the private inventory, in the **public** folder:
`<cv_path>/content/data-inventories-public/{project-slug}.md` — named after the project,
**no date**. Create the folder if absent.

Unlike the private inventory (date-versioned, never overwritten), the public file is
**overwritten in place** on every refresh — it must always reflect the current private state,
which is what kills the drift.

## Safety stamp

The output is a **review-it-first draft, not a verified-safe file** — redaction is a judgment
call and an automated pass can miss a subtle leak. State this where the user will see it after
the run, and prompt them to eyeball it before feeding it to any bot.

## Worked example (illustrative — the template above is the spec, not this)

Fictional project; demonstrates structure and the redacted end-state.

```markdown
# Fleetwave

A fleet-tracking web dashboard for live vehicle telemetry and route history.
Maciej was primary author of the React frontend, full-time for about eight
months. Tier labels (Flagship / Senior / Solid / Baseline) are his own
assessment of significance.

## Flagship
- **Real-time telemetry rewrite** — replaced a polling data layer with a
  WebSocket stream and a normalized client cache, removing the per-panel
  refetch storm on every dashboard load. (The engineer's own nominated flagship.)

## Senior
- **Map-rendering layer** — a custom `MapViewport` owning clustering,
  viewport-bound queries, and marker recycling for thousands of vehicles.

## Solid
- Route-history playback — scrubber, speed control, and gap interpolation.

## Baseline
- Sentry wiring and CI build fixes.

## CV bullets
**Polish**
1. Przepisanie warstwy danych telemetrii na strumień WebSocket ze znormalizowanym cache — koniec refetchów per-panel przy starcie
2. Warstwa renderowania mapy (`MapViewport`): klastrowanie, zapytania ograniczone do widoku, recykling markerów dla tysięcy pojazdów

**English**
1. Rewrote telemetry data layer to a WebSocket stream with a normalized cache — no more per-panel refetch on load
2. Map-rendering layer (`MapViewport`): clustering, viewport-bound queries, marker recycling for thousands of vehicles
```

**Redaction in action** — same item, private line → public line:

```
Before (private inventory):
  **Real-time telemetry rewrite** — … | 412/980 commits (42%), #1 contributor,
  co-authored with [name] | path: ~/dev/clients/<client>/fleetwave-fe

After (public-safe):
  **Real-time telemetry rewrite** — replaced a polling data layer with a
  WebSocket stream… (co-built)
```

## Generalization boundary

The skill carries only the categories and the **fictional** example above. Concrete redaction
examples (specific client names, specific anecdotes) stay in the user's per-project notes,
never in this repo — it's public; see the "No personal data in skills" convention in the repo
`CLAUDE.md`.
