# Baseline vs Senior Signal

Reference for categorizing technical achievements during CV bullet generation.

## How to use this file

When building the inventory of project achievements, label each:

- **BASELINE** — standard practice, every dev in the stack does this; not worth a bullet
- **SOLID** — okay but generic; could be a bullet if needed to fill out
- **SENIOR** — above-average signal; should usually become a bullet
- **FLAGSHIP** — user's subjective flagship claim; must become a bullet

This file is a guide, not exhaustive. When uncertain, ask the user: "Is this above what most devs in your stack do, or standard?"

The bar for SENIOR is: required research, custom code, non-obvious problem-solving, or knowledge of advanced platform features most devs don't reach for.

## Mobile (iOS, Android, React Native) — common patterns

### Baseline (do NOT include as bullet on its own)

**Auth & security:**
- Token storage in Keychain (iOS) / EncryptedSharedPreferences / Keystore (Android)
- Basic OAuth flow (Google/Apple Sign-In)
- HTTPS communication
- Basic biometric auth (FaceID/TouchID/fingerprint)
- Removing hardcoded credentials (this is hygiene, not achievement)

**Architecture:**
- Standard MVVM / MVP / MVI
- Repository pattern
- Clean Architecture (just using it; designing modules around it is different)
- Hilt/Dagger basic setup
- Standard dependency injection

**UI:**
- Standard SwiftUI / Jetpack Compose screens
- Material 3 / Human Interface Guidelines compliance
- Basic theming
- Dark mode support
- Standard navigation (NavController, NavigationStack)
- Standard animations
- Localization with strings files

**Data:**
- Room / SwiftData / Core Data basic usage
- Retrofit / URLSession / Alamofire basic usage
- Standard JSON serialization
- Basic SharedPreferences / UserDefaults

**Testing:**
- Basic unit tests with XCTest / JUnit
- Basic Espresso / XCUITest UI tests
- Mocking with Mockito / mockk

**iOS-specific:**
- Reading EXIF for image orientation (baseline practice on iOS)
- Standard `URLSession` usage
- Standard SwiftUI `@State`, `@StateObject`, `@Binding`
- Standard `Codable`

**Android-specific:**
- AndroidX basic usage
- ViewBinding / DataBinding
- Standard ViewModel + LiveData
- Basic Coroutines launch/async

**React Native:**
- Standard React Navigation
- Basic Redux / Context API
- AsyncStorage basic usage
- Standard Expo Go projects
- React Query / TanStack Query basic usage

### Solid (okay, not amazing)

**Architecture:**
- Custom DI with protocol-based abstractions (Swift) — solid, but generic in modern Swift
- Coordinators (iOS) — solid pattern, not unique
- Modularization (Gradle modules / Swift packages) — solid if more than 2-3 modules

**Networking:**
- Custom interceptors / middleware
- Retry logic
- Offline queue with sync

**Testing:**
- Snapshot testing setup
- UI test infrastructure with page objects
- Test data builders

### Senior signals

**Auth & security:**
- Refresh token rotation (not just having refresh tokens — rotating them)
- Server-revocable refresh tokens (vs just expiring)
- Token lifecycle managed in cloud storage (e.g. Firestore) vs client-only
- Actor-isolated API client preventing concurrent refresh races
- Custom certificate pinning
- Secure Enclave usage for cryptographic operations
- App Attest / DeviceCheck integration
- Custom anti-tampering / obfuscation

**Architecture:**
- Type-driven invariants (enforcing rules via type system, not runtime)
- Copy-on-write semantics for domain models (Swift, Kotlin)
- Sealed class hierarchies for state machines (Kotlin)
- Dual-channel data flow (sync + reactive) for cold-start UX optimization
- Multi-process app architecture (Android `:isolated` processes)
- Custom Gradle plugins
- Custom Swift macros (post-Swift 5.9)

**Concurrency:**
- Race condition handling in concurrent flows
- Custom dispatcher / scheduler implementations
- Backpressure handling with Flow / Combine
- Custom actors / serial queues

**AI integration:**
- Structured output via function calling / response schemas (not just parsing free text)
- Multi-stage prompt pipelines
- Streaming responses with tool call progress UI
- Custom tokenization / context window management
- Language-aware prompts (localized AI output)

**Performance:**
- Cold-start optimization with measurable improvement
- Memory profiling and reduction with numbers
- Image optimization pipeline with quality-preservation trade-off
- Custom view recycling / list virtualization

**Library extension:**
- Custom Coil/Glide fetchers
- Custom URL session protocol classes
- Custom Coroutine dispatchers / contexts
- Custom Combine publishers / SwiftUI view modifiers

**Testing:**
- Contract tests for repositories (testing invariants, not implementation)
- In-memory database for tests
- Isolated mocks per service (architecture decision)
- Property-based testing
- Custom test harness for async flows

**Reliability:**
- Crash dialog in isolated process (survives main app crash)
- Global exception handler with cloud reporting
- Custom error recovery strategies
- Offline-first architecture with conflict resolution

**Cross-platform / integration:**
- iOS → Android port with deep UX translation (not just code translation)
- Custom RN ↔ WebView bridges with auth/cookie persistence
- Header-based → cookie-based auth migration across multiple endpoint groups
- WebSocket connection management with reconnection logic

## Web / backend — common patterns

### Baseline
- Basic REST API
- Basic React / Next.js pages
- Standard CRUD
- Basic Tailwind styling
- Standard form validation
- Basic database queries

### Solid
- API versioning strategy
- Custom hooks library
- Storybook setup
- Basic monorepo (Turborepo, Nx)

### Senior signals
- Edge functions / Cloudflare Workers with non-trivial logic
- Custom React Router data loaders / actions
- Server components with streaming
- Custom build tooling
- Multi-tenant architecture
- Database query optimization with measurable improvement
- API rate limiting / throttling strategies
- Event sourcing / CQRS patterns
- WebSocket connection state management
- Custom auth flows (multi-step, MFA, passwordless)

## AI / LLM integration — common patterns

### Baseline
- Calling OpenAI / Gemini / Anthropic API with a prompt
- Parsing JSON from response
- Basic conversation history

### Solid
- Streaming responses
- Token counting
- Prompt templates

### Senior signals
- Structured output via response schema (function calling)
- Multi-stage pipelines (preprocess → call → postprocess → validate)
- Tool use / function calling with custom tools
- Language-aware prompts (localized output)
- Cost optimization (token reduction, batching)
- Retry logic with backoff
- Hybrid AI + deterministic logic (e.g. AI for parsing, code for validation)
- Custom embeddings / vector search integration
- RAG with custom retrieval

## DevOps / tooling — common patterns

### Baseline
- Basic CI/CD setup
- Basic Dockerfile
- Standard deployments

### Solid
- Multi-stage Dockerfile
- Custom GitHub Actions workflows
- Basic monitoring setup

### Senior signals
- Custom build optimization (e.g. RN bundle reduction)
- Feature flag systems
- OTA update strategies (Expo Updates, CodePush)
- Crash reporting with custom contexts
- Observability with custom event tracking aligned across platforms
- Performance budgets enforced in CI

## Process / leadership signals (when applicable)

### Senior signals (only if true and verifiable)
- Solo developer ownership (responsibility for entire app)
- Cross-repository contributions for one product
- Mentoring (only if formal — "informal Q&A" doesn't count)
- Architecture decisions with documented rationale
- Standards establishment (e.g. "established testing conventions adopted by team")

## How to question signals

When a user claims something as a senior signal, ask:

1. **Was it the default in your stack?** (If yes → baseline)
2. **Did you need to research or experiment?** (If yes → likely senior)
3. **Did you write custom code beyond library defaults?** (If yes → likely senior)
4. **Would another senior in your stack do this differently?** (If reasonable variations exist → senior)
5. **Was the problem non-obvious?** (If yes → likely senior)
6. **Can you point to a measurable outcome?** (If yes → bonus, makes it stronger)

## Updating this file

This file is reference, not exhaustive. As new patterns emerge or the user disagrees with categorizations, update accordingly. The user is the authority on their domain.
