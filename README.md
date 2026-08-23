# tfw-ts-ai

TypeScript + Playwright test suite for the REST API [Restful
Booker](https://restful-booker.herokuapp.com), the GraphQL API [Hygraph](https://hygraph.com) (Ecommerce demo
schema), and the [DemoQA](https://demoqa.com/automation-practice-form) UI form.

Forked from [demo-tfw-ts](https://github.com/konovalenko2v/demo-tfw-ts) to build out an AI-native framework where
AI is part of the architecture from the start — not just a bolted-on self-healing wrapper. Starts from the same
baseline (including the `healwright` self-healing UI locators, see "Self-Healing UI Locators" below) and adds an
AI-oriented observability layer, and later an agent-fixer, smart retry/prioritization, a self-evolving test suite,
and failure analysis.

## Prerequisites

- Node.js 18+
- Chrome/Chromium (installed via `npx playwright install`)

## How to Run

```bash
npm install
npx playwright install chromium

# Run all tests
npm test

# Run only API tests
npm run test:api

# Run only UI tests
npm run test:ui

# Run only GraphQL tests
npm run test:graphql
```

API/UI/GraphQL tests are split via Playwright `projects` (`playwright.config.ts`), so `--project=<name>` works out of
the box with no extra wiring.

Credentials for `/auth` are passed via environment variables (`.env`, see `.env.example`):

```bash
BOOKER_USERNAME=admin USER_PASSWORD=password123 npm test
```

Without the variable, the test fails with a clear `Test Run Error! Please check env variable ...` message instead of
a silent fallback — so a credential swap never goes unnoticed.

## Project Structure

```
src/
├── core/            config (host/credentials), a FileUtil-style helper for reading GQL files
├── api/
│   ├── clients/      AuthClient, BookingClient — thin wrappers over the endpoints (APIRequestContext)
│   ├── types/         Booking, CreateBookingResponse, AuthRequest/Response — interfaces, wire field names as-is
│   ├── steps/         AuthSteps, BookingSteps — test.step() wrappers for the report
│   ├── data/           booking.data.ts — test data builders on @faker-js/faker
│   └── auth/           token.provider.ts — a lazily cached token
├── graphql/           GraphQlClient (Hygraph)
└── ui/                 PracticeFormPage, ForumSteps (Playwright Page)
tests/
├── api/               auth.spec.ts, booking-crud.spec.ts, negative.spec.ts
├── graphql/            positive.spec.ts, negative.spec.ts
└── ui/                 forum.spec.ts
resources/
├── GQL/                test GraphQL queries (*.json)
└── files/              upload-test.txt for the UI test
```

## Endpoint Coverage (REST)

| Endpoint                | What's covered                                                                                                                              |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `POST /auth`           | successful and unsuccessful (invalid credentials, empty fields) authentication; on failure the status stays 200, the error is in `reason`     |
| `GET /ping`            | service availability (201)                                                                                                                    |
| `GET /booking`         | booking list, filtering by `firstname`/`lastname`/`checkin`/`checkout`                                                                        |
| `GET /booking/{id}`    | existing id (200) and non-existent id (404)                                                                                                   |
| `POST /booking`        | creation, response body validation, empty body, unicode/special characters, negative `totalprice`, invalid field types                       |
| `PUT /booking/{id}`    | full update with a token (Cookie `token`), without a token (403), with an invalid token (403)                                                 |
| `PATCH /booking/{id}`  | partial update                                                                                                                                 |
| `DELETE /booking/{id}` | with a token (201), without a token (403), with an invalid token (403)                                                                        |

The auth token is passed on every protected request via **Cookie `token`**, not `Authorization: Bearer`.

`booking-crud.spec.ts` uses a shared fixture booking (`beforeAll`/`afterAll`) and cleans up every booking it created
through a separate `APIRequestContext` created manually (`playwrightRequest.newContext()`) rather than the
worker-scoped `{ request }` fixture — Playwright doesn't allow reusing a test fixture inside `afterAll`.
`negative.spec.ts` cleans up its created bookings after each test via `afterEach`.

## GraphQL and UI

- `positive.spec.ts`/`negative.spec.ts` (graphql) run queries against the public Hygraph demo schema (pagination,
  nested fields, invalid queries) — test queries live in `resources/GQL/*.json`.
- `forum.spec.ts` — an end-to-end scenario filling out and submitting the DemoQA form via Playwright (headless by
  default).

## Test Strategy

Tests are split by interface (`api`/`graphql`/`ui`) via separate Playwright `projects` rather than lumped into one
package — this lets them run independently and keeps the browser out of runs that only need HTTP. Inside `api`,
three layers are separated: `clients` (bare HTTP via `APIRequestContext`), `steps` (`test.step()` wrappers for the
report), `tests` (scenarios and assertions).

Authorization uses a lazily cached token (`token.provider.ts`) instead of fetching a token in module-level code on
every run — the token is requested once per run, and only when it's actually needed.

The `api` and `graphql` projects run with `fullyParallel: false` — tests within a single file run sequentially
rather than in parallel, because both external services (the restful-booker Heroku app and the Hygraph demo CDN)
return `429 Too Many Requests` under aggressive parallel load; the `ui` project stays fully parallel.

## Coverage Notes

- There is deliberately no stub test designed to fail on its first attempt just to populate a retry tab in the
  report — that would break the "all tests green" guarantee without adding real coverage value.
- `data: null` in GraphQL error-validation responses is real Hygraph API behavior (verified with `curl`), hence the
  assertion `expect(body.data).toBeNull()` rather than `toBeUndefined()`.

## Self-Healing UI Locators

[Healenium](https://healenium.io) was evaluated for the `ui` project but doesn't fit: its free/OSS proxy only
speaks the Selenium WebDriver protocol, and Playwright doesn't use WebDriver at all (it drives the browser over
CDP/its own protocol). A Playwright integration exists, but only under Healenium Pro (commercial).

Instead, `ui` uses [healwright](https://github.com/amrsa1/healwright) — an OSS, Playwright-native self-healing
wrapper. When a locator stops matching, it asks an LLM (Anthropic/OpenAI/Google/Ollama) to re-identify the element
from a text description, and caches the healed selector under `.self-heal/` (gitignored) for next time.

Wiring:

- `src/ui/fixtures.ts` extends the base Playwright `test`/`page` fixture with `createHealingFixture()`, typing
  `page` as `HealPage`.
- `tests/ui/forum.spec.ts` imports `test`/`expect` from `../../src/ui/fixtures` instead of `@playwright/test`.
- `PracticeFormPage`/`ForumSteps` take a `HealPage` and use `page.heal.click(locator, "description")` for the
  most brittle locators on the page — the `react-select`-generated `#react-select-N-option-0` ids, which depend
  on render order rather than any stable attribute.

Self-healing is opt-in via environment variables (see `.env.example`):

```bash
SELF_HEAL=1
AI_PROVIDER=anthropic   # or openai/gpt, google/gemini, local/ollama
AI_API_KEY=...          # not needed for the local/ollama provider
```

Without `SELF_HEAL=1`, `heal.*` calls behave like their plain Playwright equivalents — there's no AI dependency
or extra latency in normal CI runs. Turn it on locally when a DemoQA markup change breaks a locator, to confirm
whether an AI-healed selector recovers the flow before hand-fixing the locator in code.

## AI Observability Layer

Every business action across all three projects (api/graphql/ui) already goes through Playwright's
`test.step(...)`. `src/observability/reporter.ts` is a custom Playwright `Reporter` that taps that boundary from
the main process — no changes to any existing `clients`/`steps`/`pages` file — and writes one append-only JSONL
file per run to `.observability/run-<runId>.jsonl` (gitignored, mirrors `.self-heal/`).

Two record types, discriminated by `type`:

- **`step`** — one per business-level `test.step`, or per standalone failing assertion with no `test.step`
  ancestor. Carries `outcome: "passed" | "failed" | "passed_with_recovery"`, the extracted `target`
  (action/selector/urlPath, parsed from the underlying Playwright API call), and a sanitized `error` (ANSI
  stripped, message/snippet capped to ~2KB, stack trimmed to non-`node_modules` frames). `passed_with_recovery`
  is the interesting one: a low-level step failed (e.g. a locator timed out) but its parent `test.step`
  ultimately succeeded — a signal that's invisible in Allure/HTML today (they'd just show a green test), but is
  exactly what a broken-then-self-healed locator (see `healwright` above) looks like.
- **`test`** — one per test attempt, with `status`, `outcome` (`TestCase.outcome()`, so `flaky` is distinguishable
  from `expected`), step/recovery counts, and `artifacts[]` referencing screenshot/trace/error-context paths
  (never inlined).

Join key across both: `testId` + `testTitlePath`. This does **not** ingest `.self-heal/heal_events.jsonl` —
they're independent logs, correlated by test name, meant to be read together by a later failure-analysis
component rather than merged into one file now.

Purely additive: `npm test` remains the single entry point, and `allure-results`/`playwright-report` are
unaffected in content.

## Agent-Fixer

`src/agent-fixer/` closes the loop the observability layer opens: it doesn't watch for red tests — a locator
that healwright silently heals at runtime never turns a test red, so a failure-triggered fixer would rarely
fire on the exact class of bug it exists for. Instead it reads `.observability/` for `passed_with_recovery`
steps — a locator broke in source but was recovered live by healwright — and proposes replacing the broken
locator with the working strategy healwright already found and cached in `.self-heal/healed_locators.json`.

`npm run agent-fixer`:

1. Reads the latest `.observability/run-*.jsonl` for `passed_with_recovery` steps and collects every broken
   selector from their `recoveredErrors[]`, dropping any selector whose `heal.click(...)` line in source is
   preceded by an `agent-fixer: skip` comment (checked in code, not left to the model) — that's how the
   `#react-select-3-option-broken` healwright demo fixture (see "Self-Healing UI Locators" above) stays broken
   on purpose instead of getting "fixed" on the first run.
2. Sends the remaining broken selectors, plus the raw contents of `.self-heal/healed_locators.json`, to Gemini
   (`src/agent-fixer/fix-proposer.ts`, reusing the same `AI_API_KEY` healwright already needs — no extra paid
   credential required) and asks for a small structured JSON response: for each selector, a Playwright locator
   expression built from the strategy healwright already found and cached, or `found: false` if it can't
   confidently match one. The join between a broken selector and its healed replacement happens inside that
   prompt (each cache entry's `context` field is the `contextName` argument already paired with the broken
   locator in source).
3. Creates a branch (`agent-fixer/<timestamp>`), applies each confident fix as a plain string replacement of
   the first `heal.click(...)` argument, and runs `npx tsc --noEmit` to confirm the result compiles.
4. Commits, pushes, and opens a PR — only if at least one fix was actually applied.

A `claude`-CLI-driven alternative (`proposeFixesWithClaudeCode`, commented out in `fix-proposer.ts`) reads and
edits the file itself instead of returning structured JSON for `run.ts` to apply — it generalizes better to
fixes more complex than "replace one argument," at the cost of needing a paid `ANTHROPIC_API_KEY`. Swap the
import in `run.ts` to switch once that's available.

In CI (`.github/workflows/regression.yml`), `agent-fixer` is a separate job from `test`, gated to `success`
pushes on `master` and skipped when the triggering branch already starts with `agent-fixer/` (the loop guard —
without it, a fixer PR that got its own CI run and produced another recovery would spawn a fixer PR of its
own). `test` keeps its default `contents: read` permission and hands `.observability/`/`.self-heal/` to
`agent-fixer` via `actions/upload-artifact` + `actions/download-artifact`, so only the job that actually needs
to push and open a PR carries `contents: write`/`pull-requests: write` — and pushes with a `FIXER_PAT` secret
rather than the default `GITHUB_TOKEN`, since PRs opened with the default token don't trigger their own CI run
(which is also why the PAT is what makes the fixer's own PR reviewable with a real test run instead of blind).

## Reports

Playwright collects its built-in HTML report and `allure-playwright` results at the same time:

```bash
npm test
npm run report            # open the Playwright HTML report
npm run allure:generate   # build a static Allure report from allure-results/
npm run allure:serve      # build and immediately open the Allure report (requires the Allure CLI)
```
