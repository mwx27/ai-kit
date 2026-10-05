# Examples of Mistakes — Real Iterations

These examples come from real CV iteration work. Each shows a draft that *seemed fine* but was wrong, why it was wrong, and what fixed it. Use these to inform self-review.

The pattern: most mistakes feel professional and acceptable at first read. The user's critical questions revealed them. This skill must learn to ask those questions before presenting drafts.

## Mistake 1: Empty adjectives doing the work

**Draft:**
> "Replaced an insecure auth stack with a token-based flow backed by Keychain — eliminating credentials shipped in the binary"

**The user's question:** "Does 'insecure' make sense here?"

**Why it's wrong:**
- "Insecure" is an empty rating — it doesn't say *what* made it insecure
- The second half of the bullet ("eliminating credentials shipped in the binary") already explains the specific problem
- "Insecure" does the work the concrete detail should do

**Better:**
> "Replaced auth mechanism with hardcoded credentials with tokens stored in Keychain"

But then: see Mistake 4 (this is throwing teammates under the bus).

**Lesson:** When you find yourself reaching for "insecure", "robust", "dangerous", "modern", "advanced", "elegant" — stop. Ask: what concrete detail does this adjective stand in for? Use the detail instead.

## Mistake 2: Grammatical calques (Polish)

**Draft:**
> "Zastąpiłem niebezpieczny auth stack na token-based flow oparty o Keychain"

**The user's question:** "Czy to brzmi dobrze po polsku?"

**Why it's wrong, point by point:**
- "auth stack" + "token-based flow" — two English noun phrases collide without bridge
- "token-based flow" — English adjective order in Polish sentence
- "oparty o" — incorrect; should be "oparty na" (oparcie o = physical leaning)
- "Zastąpić X na Y" — incorrect; should be "Zastąpić X Y" (instrumental) or "Zastąpić X przez Y"

**Better:**
> "Zastąpienie mechanizmu autentykacji tokenami przechowywanymi w Keychainie"

But still problematic — see Mistake 3.

**Lesson:** Polish has stricter grammatical rection than English. Verbs require specific cases. When in doubt about an English term in a Polish sentence, restructure with Polish lead words.

## Mistake 3: Phrase collision in Polish narrative

**Draft:**
> "Zastąpienie podatnego mechanizmu autentykacji tokenami przechowywanymi w Keychainie"

**The user's question:** "To wszystko mi się zlewa w jedno, tak jakby ten podatny mechanizm autentykacji to była właśnie tokeny przechowywane w keychainie"

**Why it's wrong:**
- Instrumental "tokenami" follows directly after genitive "mechanizmu autentykacji"
- Without a separator (preposition like "przez"), Polish brain reads them as one long noun phrase
- The two sides of the replacement blur together

**Better:**
> "Migracja z podatnego mechanizmu autentykacji na tokeny przechowywane w Keychainie"

"Migracja z X na Y" has two explicit prepositions (z, na) which separate the sides clearly.

**Lesson:** Polish lacks the clean "X with Y" separator of English. When swapping things, prefer constructions like "migracja z X na Y" or "wymiana X na Y" that have explicit prepositions.

## Mistake 4: Bragging about baseline as if it's an achievement

**Draft:**
> "Zastąpienie mechanizmu autentykacji z zaszytymi danymi logowania tokenami w Keychainie"

**The user's question:** "Pisanie o zahardcodowanych credentialach to jest pisanie źle o osobach z zespołu oraz rzecz tak oczywista że tak się nie robi, że nie ma co się tym chwalić."

**Why it's wrong:**
- Hardcoded credentials in iOS binary are extractable in 5 minutes with `strings`/Hopper
- Every iOS dev past their first year knows this
- "Fixing" baseline mistakes is hygiene, not achievement
- Bragging about it implicitly criticizes whoever made the mistake — bad professional optics
- Like bragging about correcting a colleague's typo

**Better:** Cut the bullet entirely if it's just baseline hygiene.

**Lesson:** Before adding a security/quality bullet, ask:
- Is this above what most devs in this stack do, or standard?
- Am I bragging about cleaning up someone else's baseline mistake?

If yes to either → reconsider.

## Mistake 5: Baseline disguised as achievement

**Draft:**
> "Authentication based on token in Keychain"

**The user's question:** "A czy autentykacja z tokenami w keychainie to nie jest przypadkiem baseline sam w sobie?"

**Why it's wrong:**
- Token + secure storage is the *only* sensible way to do auth in iOS in 2025+
- Standard Apple framework usage
- Not a senior signal

**What WOULD be senior:**
- Refresh token rotation
- Server-revocable refresh
- Actor-isolated API client with concurrent refresh handling
- Certificate pinning

**Better:**
> "Authentication built on short-lived JWTs in Keychain, refresh token rotation, and actor-isolated API client with deduplicated refresh"

**Lesson:** If a bullet describes "using a standard library the standard way", it's baseline. Look for what required custom thinking — that's the signal.

## Mistake 6: Tautologies

**Draft:**
> "Pipeline analizy AI — Gemini Vision zwracający ustrukturyzowany JSON w języku użytkownika"

**The user's question:** "Ustrukturyzowany JSON brzmi jak masło maślane"

**Why it's wrong:**
- JSON is by definition structured (JavaScript Object Notation = structure)
- "Structured JSON" is redundant unless you mean "schema-conformant" (different concept)

**Better:**
> "Pipeline analizy AI — Gemini Vision zwracający JSON zgodny ze schematem w języku użytkownika"

Or, accepting the user's later preference for brevity:
> "Pipeline analizy ubrań Gemini Vision — schemat JSON, odpowiedź w języku użytkownika"

**Lesson:** Watch for tautologies. Common offenders:
- "structured JSON" (JSON = structured)
- "advanced senior" (senior = advanced)
- "custom bespoke" (same word)
- "reliable backup" (backup implies reliability)

## Mistake 7: Calques as labels ("klasy produkcyjnej")

**Draft:**
> "Autentykacja klasy produkcyjnej: krótkożyjące JWT w Keychainie..."

**The user's question:** "Co dokładnie oznacza autentykacja klasy produkcyjnej? Nie spotkałem się z takim sformułowaniem po polsku, więc nie do końca mi się podoba"

**Why it's wrong:**
- "Klasy produkcyjnej" is a calque of "production-grade"
- In English, "production-grade" is established term-of-art
- In Polish, it's an awkward phrase with no clear meaning
- Sounds like ISO classification language ("urządzenie klasy A")

**Better:** Cut the label entirely. The concrete details (JWT, rotation, actor isolation) already prove the production-readiness. Show, don't tell.

**Lesson:** When tempted to add a quality label, check:
- Is this established term-of-art in the target language?
- Do the concrete details already imply this quality?
- Could I cut the label and let the details speak?

Usually yes, yes, yes — cut.

## Mistake 8: Multiple signals glued together

**Draft:**
> "Pipeline analizy AI z dwuetapową kompresją (5–8 MB → 200–500 KB) i Gemini Vision zwracającym JSON zgodny ze schematem w języku użytkownika"

**The user's question:** "Czy z tego nie lepiej zrobić 2 bullety?"

**Why it's wrong:**
- This bullet carries two distinct competencies glued together:
  - Mobile engineering (image compression with numbers)
  - AI integration (structured output, localization)
- Each deserves its own visibility
- A reader scanning will catch one or the other, not both
- The numbers (5–8 MB → 200–500 KB) lose impact when buried mid-sentence

**Better (split into two):**
> "Pipeline analizy ubrań Gemini Vision — schemat JSON, odpowiedź w języku użytkownika (PL/EN)"
> "Dwuetapowa kompresja zdjęć (5–8 MB → 200–500 KB) bez utraty jakości analizy"

**Lesson:** If a bullet has "and" or a comma joining two distinct competencies/topics, consider splitting. Each bullet should carry one signal cleanly.

## Mistake 9: Header duplication in first bullet

**Draft header:**
> WardrobeApp (aplikacja Android — wirtualna szafa)
> 10.2025 • produkt wewnętrzny • jedyny inżynier • web → Android

**Draft first bullet:**
> "Aplikacja Androida zbudowana od zera jako solo Android developer, na bazie istniejącego prototypu webowego"

**The user's question:** "Punkt pierwszy jest bez sensu. To jest duplikacja tego co w nagłówku"

**Why it's wrong:**
- Header already says: Android, solo, web → Android port
- First bullet repeats: Android, solo, built from web prototype
- Wastes the most valuable slot in the bullet list

**Better:** Use bullet 1 for the strongest *new* signal — e.g. the AI pipeline, the most flagship achievement.

**Lesson:** Before writing bullets, identify what the header already communicates. The bullets should add new information, not paraphrase the header.

## Mistake 10: Frankenstein words

**Draft:**
> "Dwuprzepływowe repozytorium autentykacyjne (sync + Flow) eliminujące mignięcie UI przy starcie"

**The user's question:** "Dwuprzepływowe jest słabe. Może dwukanałowe repozytorium ... ?"

**Why it's wrong:**
- "Dwuprzepływowe" is a forced calque of "dual-stream"
- "Przepływ" in Polish tech-speak isn't well-established
- Sounds artificial

**Better:**
> "Dwukanałowe repozytorium autentykacyjne (sync + Flow) eliminujące mignięcie UI przy starcie"

"Kanał" is natural Polish (kanał komunikacyjny, kanał TV, kanał RSS).

**Lesson:** When inventing compound Polish words from English concepts, check:
- Does this Polish root naturally collocate with this prefix/suffix?
- Is there a more natural Polish word for the underlying concept?
- Does it sound like real Polish or like translated English?

## Mistake 11: Over-claiming through verb choice

**Draft:**
> "Re-architected the codebase to MVVM-lite..."

**The question to ask:** Was there a prior architecture to re-architect?

**Why it might be wrong:**
- "Re-architected" implies replacing existing architecture
- If the prototype had no architecture (just scaffolding), there was nothing to re-architect — you *introduced* architecture
- Word choice should match factual situation

**Better, depending on facts:**
- Prior architecture existed → "Re-architected..." (accurate)
- No prior architecture → "Introduced an MVVM-lite architecture..."

**Lesson:** Verb choice matters. "Built", "Designed", "Implemented", "Introduced", "Re-architected", "Bootstrapped", "Established" each imply different starting conditions. Match the verb to reality.

## Mistake 12: Redundancy in verb idioms

**Draft:**
> "Bootstrapped the test suite from scratch"

**The user's question:** "From scratch jest tu potrzebne?"

**Why it's wrong:**
- "Bootstrap" idiomatically means "from scratch"
- "Bootstrapped from scratch" is double-stating

**Better:**
> "Bootstrapped the testing infrastructure"

**Lesson:** Watch for verbs that imply their own modifiers:
- "Bootstrapped from scratch" (bootstrap = from scratch)
- "Built from the ground up from scratch" (double)
- "Established for the first time" (establish = first time)
- "Created from nothing" (create = from nothing)

## Mistake 13: Wrong term entirely

**Draft:**
> "Zastąpienie podatnego mechanizmu autoryzacji..."

**The user's question:** "Tu chyba bardziej chodzi o autentykację niż autoryzację"

**Why it's wrong:**
- Authentication = WHO you are (verifying identity)
- Authorization = WHAT you can do (checking permissions)
- Token-based login is authentication
- RBAC / permissions is authorization

**Better:**
> "Zastąpienie podatnego mechanizmu **autentykacji**..."

**Lesson:** Know the precise meaning of technical terms. English "auth" conflates both; Polish requires distinction. Other commonly confused pairs:
- Latency vs throughput
- Concurrency vs parallelism
- Mocking vs stubbing vs faking
- Synchronous vs blocking

## Mistake 14: "Test suite" when you mean "test infrastructure"

**Draft:**
> "Bootstrapped the test suite — Swift Testing, in-memory SwiftData, isolated mocks per service"

**The user's question:** "A test suite? Mi brzmi trochę dziwnie"

**Why it's wrong:**
- "Test suite" = a collection of tests (the test files themselves)
- What was actually built: framework setup, persistence strategy, mock patterns — *foundation* for writing tests
- The bullet describes *testing infrastructure*, not a test suite

**Better:**
> "Bootstrapped the testing infrastructure — Swift Testing, in-memory SwiftData, isolated mocks per service"

**Lesson:** Use precise terms:
- Test suite = collection of tests
- Test infrastructure / testing foundation = setup that enables tests to be written
- Test framework = library like XCTest / JUnit
- Test runner = system that executes tests

## Self-review principles (derived from these examples)

When reviewing a draft bullet, ask:

1. **Is each adjective doing concrete work?** No "robust", "advanced", "modern", "dangerous" without concrete content.

2. **Is anything tautological?** "Structured JSON", "advanced senior", etc.

3. **Is this baseline or above?** If standard library used standardly, baseline.

4. **Am I bragging about cleaning up baseline mistakes?** Skip or reframe.

5. **Does grammar work in the target language?** Especially Polish: case agreement, preposition choice, no calques.

6. **Are two distinct signals glued together?** Consider splitting.

7. **Does the first bullet duplicate the header?** Use bullets for new information.

8. **Are technical terms precise?** Auth/authz, test suite/infrastructure, latency/throughput, etc.

9. **Is verb choice accurate?** "Re-architected" requires prior architecture, "bootstrapped" implies from nothing, etc.

10. **Are quality labels honest or hollow?** "Production-grade", "industry-leading", "best-in-class" — usually hollow, cut.

When in doubt, ask the user. The user knows their domain; this skill knows the patterns of how CVs go wrong.
