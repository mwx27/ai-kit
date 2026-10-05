# Style Guide — CV Bullets

Rules for writing CV bullets in Polish and English. Apply during composition and self-review.

## Universal principles

### Concrete over generic
- **Bad**: "Improved app performance"
- **Good**: "Reduced cold start from 3.2s to 1.1s via lazy module init"

### Numbers expose results
Whenever a measurable change exists, put the number in:
- `5–8 MB → 200–500 KB`
- `12 endpoint groups migrated`
- `~200 components refactored`

### Show, don't tell
Avoid self-rating labels. Let the concrete details prove the quality.
- **Bad**: "Production-grade authentication"
- **Good**: "Authentication with short-lived JWTs, refresh rotation, and actor-isolated client"

### One signal per bullet
If a bullet carries two genuinely distinct signals (e.g. mobile optimization + AI integration), split it. Don't glue.

### No header duplication
The header already says: project name, dates, role, tech stack, status. Don't repeat these in bullets. The first bullet should be the strongest *new* signal.

## Polish-specific rules

### Form: rzeczownik odczasownikowy (verb noun)
All bullets use noun form:
- "**Przejęcie** wczesnego prototypu i **doprowadzenie** aplikacji do wersji beta"
- "**Wprowadzenie** architektury MVVM-lite..."
- "**Utworzenie** infrastruktury testowej..."

Not first-person verbs ("Przejąłem", "Wprowadziłem"). The noun form is the modern Polish CV convention in tech.

Exception: when noun form sounds forced, restructure with a different lead word ("Autonomia", "Pipeline", "Repozytorium", "Integracja"). These work as topic-leading nouns followed by description.

### Grammar — common Polish CV mistakes

**"Oparty na" not "oparty o":**
- ✓ "DI **oparty na** protokołach"
- ✗ "DI **oparty o** protokoły"

(`oparty o` is physical leaning. `oparty na` is conceptual basis.)

**"Zastąpić X Y" (narzędnik) or "zastąpić X przez Y", never "zastąpić X na Y":**
- ✓ "Zastąpienie mechanizmu autentykacji **tokenami** w Keychainie"
- ✓ "Zastąpienie mechanizmu autentykacji **przez tokeny** w Keychainie"
- ✗ "Zastąpienie mechanizmu autentykacji **na tokeny** w Keychainie"

Note: "Wymienić X **na** Y" IS correct (different verb, different rection).

**"Autentykacja" (authentication) ≠ "autoryzacja" (authorization):**
- Authentication = identity verification (login, token, password)
- Authorization = permission check (can user X do action Y?)
- Token-based login = authentication
- RBAC = authorization

Don't conflate. The English "auth" is ambiguous; Polish requires precision.

### Anglicisms — when to keep, when to translate

**Keep in English (term of art):**
- Code-level: `@Observable`, `@MainActor`, JWT, OAuth, MVVM, MVP, DI
- Library/API names: Keychain, Firestore, Flow, Hilt, Compose, SwiftUI
- LLM/AI: function calling, structured output, prompt engineering
- Concurrency: actor isolation, race conditions (or use "warunki wyścigu" if preferred — both work)

**Translate to Polish:**
- "Stack" → "warstwa" / "mechanizm" / "system" (context-dependent)
- "Binary" → "skompilowana aplikacja" (more universal than "binarka")
- "Build" → "kompilacja" / "wersja"
- "Flow" (as in "user flow") → "przepływ" / "ścieżka"
- "Output" (as in "result") → "wynik" / "odpowiedź" (NOT "output" in Polish text)
- "Pipeline" → keep as "pipeline" (idiomatic in Polish tech, no good translation)

**Avoid Frankenstein words:**
- ✗ "Flow tokenowy" (Polish suffix on English root, awkward)
- ✗ "Dwuprzepływowy" (forced calque of "dual-stream")
- ✓ "Dwukanałowe repozytorium" (Polish word with natural meaning)
- ✓ "Tokeny przechowywane w Keychainie" (Keychain inflected naturally)

### Style — Polish

- Avoid bureaucratic constructions ("w oparciu o" if it weakens). Use "na bazie" or restructure.
- "W ramach" sometimes better than "w oparciu o" when conveying boundaries vs foundation
- "Mając jedynie X" sounds defensive; "z minimalnymi wytycznymi" or restructuring often better
- Don't repeat root words in one bullet ("uwierzytelniania" + "uwierzytelniające" = clunky)

## English-specific rules

### Form: action verbs, past tense
- **Took over** an early prototype
- **Designed** authentication with...
- **Built** a type-safe wardrobe model
- **Bootstrapped** the testing infrastructure

Not noun form ("Taking over...", "Design of...") — those sound passive in English CVs.

### "From scratch" rule
Don't say "X from scratch" if the verb already implies it:
- ✗ "Bootstrapped the test suite **from scratch**" (bootstrap = from scratch)
- ✗ "Built **from the ground up** from scratch" (double)
- ✓ "Bootstrapped the test suite"
- ✓ "Built from the ground up" (intentional emphasis)
- ✓ "Established the testing infrastructure" (no need for "from scratch")

### Adjective economy
Cut adjectives that don't add information:
- ✗ "Production-grade auth"
- ✗ "Robust testing infrastructure"
- ✗ "Comprehensive integration"
- ✓ State what makes it production-grade/robust/comprehensive in concrete terms

### Articles
- "Keychain" is a proper noun, no `the`. "tokens stored in Keychain", not "in the Keychain".
- "the codebase" / "an MVVM-lite architecture" — natural article usage.

### "Built/Designed/Implemented" choice
- **Designed** — emphasizes thinking and decisions (good for architecture, API design)
- **Built** — emphasizes construction (good for features, infrastructure)
- **Implemented** — neutral, sometimes safer when "designed" overclaims
- **Shipped** — emphasizes delivery (good for end-to-end features in production)
- **Bootstrapped** — implies from-nothing creation (good for setup work)
- **Re-architected** — implies replacing existing architecture (requires existing arch)
- **Introduced** — implies adding what wasn't there (no prior arch needed)

Choose verb based on factual accuracy. "Re-architected" requires prior architecture to re-architect.

## Common errors to avoid (both languages)

### Tautologies
- "Structured JSON" — JSON is structured by definition (PL: "ustrukturyzowany JSON")
- "Advanced senior engineer" — "senior" already implies advanced
- "Reliable backup system" — backup implies reliability
- "Custom-built bespoke solution" — same word twice

Replace with what actually distinguishes:
- "JSON conforming to schema" / "schema-conformant JSON" / "JSON zgodny ze schematem"
- "Senior engineer with 10+ years" — concrete years
- etc.

### Empty adjectives
Adjectives that mean "good" without saying how:
- "Dangerous" — say WHAT made it dangerous
- "Modern" — say what modern means here
- "Robust" — say what it withstands
- "Elegant" — say what makes it elegant
- "Senior-grade" — say what makes it senior-grade

### Production-jargon hollow words
- "Best practices" — what practices?
- "Industry standards" — what standards?
- "Cutting-edge" — never; either name the tech or skip
- "Synergies" — never
- "Mission-critical" — define criticality concretely

### Throwing team under the bus
Don't write bullets that brag about fixing your teammates' baseline mistakes:
- ✗ "Fixed hardcoded credentials shipped in production"
- ✗ "Replaced insecure auth shipped in binary"
- ✓ Skip entirely if it was baseline hygiene
- ✓ Or reframe as your design choice: "Designed auth with tokens in Keychain"

## Length discipline

**Default ceiling: 105 characters per bullet. This is a ceiling, not a target.**

Most bullets land between 60 and 105. A 70-char bullet that says everything it needs to say is better than a 102-char bullet padded to look balanced. **Don't engineer all bullets in a section to similar lengths** — natural composition produces variation. If a draft has 5 bullets clustered at 95-105 chars, that's a signal that some are padded.

**Extended slot — up to 170 characters, max ONE per section:**

A single bullet per section may stretch to 170 chars when it carries a genuinely dense signal — one where splitting into two bullets would weaken each half. Example: a migration story with three connected steps where the *connection between them* IS the signal.

This slot is independent of category — it can be a FLAGSHIP, SENIOR, or SOLID bullet. Length is a function of signal density, not subjective importance.

Use sparingly. Most sections will not use the extended slot at all.

**When a bullet exceeds 105 (and isn't the extended-slot one):**

1. Cut secondary details (parenthetical examples, qualifying clauses)
2. Use shorter synonyms ("eliminating" → "no", "with" → "—")
3. Restructure to be more compact (move details into nested structure if format allows)
4. Last resort: check if bullet carries two distinct signals → split into two

**When well under limit (e.g. 60 chars):**

Leave it. Not every bullet must hit the ceiling. The bullet is done when it says what it needs to — adding a "useful concrete detail" just to pad the length usually backfires by diluting the signal.

**When over 170:**

The bullet must split, no exceptions. 170 is the hard ceiling for anything that goes in CV.
