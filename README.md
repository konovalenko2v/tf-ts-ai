# tf-ts-ai

TypeScript + Playwright test suite for the REST API [Restful
Booker](https://restful-booker.herokuapp.com), the GraphQL API [Hygraph](https://hygraph.com) (Ecommerce demo
schema), and the [DemoQA](https://demoqa.com) UI pages.

Forked from [demo-tfw-ts](https://github.com/konovalenko2v/demo-tfw-ts) to build an **AI-native QA framework** —
one where AI isn't a bolted-on wrapper around one flaky locator, but a layer running through observability,
self-repair, test selection, and triage.

## Status at a glance

| #   | Feature                                                       | Status  | What it does                                                                                                                                                                                                           | Why it matters                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------- | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Self-Healing UI Locators](#1-self-healing-ui-locators)       | 🟢 100% | AI re-finds a broken locator at runtime, caches the fix                                                                                                                                                                | A cosmetic markup change (an id/class rename) doesn't turn the test red — the AI patches around it live instead of a human fixing the locator by hand                                                                                                                               |
| 2   | [AI Observability Layer](#2-ai-observability-layer)           | 🟢 100% | Structured JSONL log of every test step, including silent recoveries                                                                                                                                                   | Gives every other AI feature below the structured data it needs to work from — without this, nothing downstream (fixer, triage, analysis) has anything to read                                                                                                                      |
| 3   | [Agent-Fixer](#3-agent-fixer)                                 | 🟡 ~90% | Opens a PR that patches source code for a locator healing already fixed at runtime                                                                                                                                     | Turns a _live_ fix (self-healing, gone if the cache is cleared) into a _permanent_ one committed to source, so the same locator doesn't need re-healing every run                                                                                                                   |
| 4   | [Failure Analysis](#4-failure-analysis)                       | 🟢 100% | Groups failures by real cause, states a retry verdict per cause                                                                                                                                                        | Saves a human from reading 20 red tests one by one — collapses them into "these are the same root cause" and says whether retrying is even worth it                                                                                                                                 |
| 5   | [Affected-Test Selection](#5-affected-test-selection)         | 🟢 100% | Runs only the specs a change can actually affect, via a real TS import graph                                                                                                                                           | Faster PR feedback — a one-file change doesn't have to wait for the entire suite to run before you know if it broke something                                                                                                                                                       |
| 6   | [Jira-Driven Red-Test Triage](#6-jira-driven-red-test-triage) | 🟡 ~60% | Reads Jira context for a failing assertion, verdicts bug vs. intentional change                                                                                                                                        | **Triage** = sorting failures by what actually needs attention. A red test isn't automatically a bug — it might just be asserting old, now-intentionally-changed behavior. This tells you which, using the ticket that likely caused it, instead of a human having to go look it up |
| 7   | [Self-Evolving Test Suite](#7-self-evolving-test-suite)       | 🟡 ~70% | AI proposes a new edge-case test, only opens a PR if it demonstrably passes                                                                                                                                            | Grows coverage without waiting for a human to think up every edge case — but only ever proposes a test it already proved passes, never an unverified guess                                                                                                                          |
| 8   | [Goal-Based Tests](#8-goal-based-tests)                       | 🟡 demo | Agent resolves a plain-English goal into a driver, from page-knowledge alone, judged by a fixed human-written oracle it never sees                                                                                     | Proves the framework's pieces (page-knowledge, personas, CLI fallback) compose into "describe intent, not steps" — deliberately one demo goal, not a general capability yet                                                                                                         |
| 9   | [Page Knowledge Cache](#9-page-knowledge-cache)               | 🟢 100% | Committed per-page DOM/behavior notes — skip re-exploring a page already documented                                                                                                                                    | Saves real time/tokens — writing a test for a page already explored once doesn't require opening a browser and re-discovering its structure from scratch                                                                                                                            |
| 10  | [AI Agent Personas](#10-ai-agent-personas)                    | 🟡 ~80% | Standardized personas (test-developer, locator-medic, reviewer-tests, qa-analyst, goal-solver) with a 4-tier CLI fallback (Claude + 3 Gemini models, optionally on separate API keys) and a separate review-tier model | One place to read/edit what each AI role is instructed to do, instead of an inline prompt string buried in each module — and a second, differently-modeled review gate before a generated test ships                                                                                |
| 11  | [Retry Verdicts](#4-failure-analysis)                         | 🟡 ~50% | Names why each failure cause is or isn't worth retrying; the AI dispatcher adds a categorised advisory verdict for causes the rule-based table can't name                                                              | Makes retry cost visible instead of implicit in a retry count. The half that stays unbuilt is _acting_ on it — Playwright fixes `retries` per project before the run starts, so per-failure budgets need a runner-level change, not a caller (see below)                            |
| 12  | Intent-Based Testing + **draft** PR on a jira-triage verdict  |  ⚪ 0%  | Not built — jira-triage stops at the verdict, no fix generation. If built: draft PR only, never auto-merge                                                                                                             | Would close the loop #6 opens: once triage confirms "this test is just outdated," propose the updated test instead of leaving a human to rewrite it — but an AI that edits a failing test until it passes is a machine for producing green meaningless tests, so a human must merge |

🟢 built and wired into CI · 🟡 built, partially wired or with a known gap · ⚪ not built yet

## Prerequisites

- Node.js 24 (pinned in `.nvmrc` and enforced by `engines` in `package.json`; CI reads the same
  `.nvmrc` via `node-version-file`, so the local and CI runtime can't drift apart)
- Chrome/Chromium (installed via `npx playwright install`)

## How to Run

```bash
npm install
npx playwright install chromium

# Run all tests
npm test

# Run only API / UI / GraphQL tests
npm run test:api
npm run test:ui
npm run test:graphql

# Run only what a local change can affect
npm run test:affected
```

API/UI/GraphQL tests are split via Playwright `projects` (`playwright.config.ts`), so `--project=<name>` works out
of the box with no extra wiring.

Credentials for `/auth` are passed via environment variables (`.env`, see `.env.example` for every variable this
project reads — nothing is hardcoded anywhere in source):

```bash
BOOKER_USERNAME=admin USER_PASSWORD=password123 npm test
```

Without `BOOKER_USERNAME`/`USER_PASSWORD`, the test run fails fast with a clear `Test Run Error! Please check env
variable ...` message instead of a silent fallback — a credential swap never goes unnoticed.

> [!IMPORTANT]
> `.env` is gitignored and never committed; `.env.example` holds placeholder values only. Real API keys, Jira
> tokens, and passwords live in GitHub Actions secrets (`AI_API_KEY`, `USER_PASSWORD`, `JIRA_API_TOKEN`,
> `FIXER_PAT`, …), never in code or in this file.

### Target environment

The three base URLs are read from the environment, so the same suite can be pointed at a staging copy, a preview
deployment, or a locally served build without editing source:

```bash
API_BASE_URL=https://booker.staging.internal \
UI_BASE_URL=https://qa.staging.internal \
npm test
```

All three are optional — unset, each falls back to the public demo service this repo was built against, so a fresh
checkout runs with no configuration. A trailing slash is tolerated. Per-page UI paths (`/text-box`, `/webtables`, …)
are **derived** from `UI_BASE_URL` in `src/core/config.ts` rather than configured separately, since a UI deployment
moves as a whole — previously the host was repeated across six entries, where changing it meant changing every one
and missing one failed silently.

### Code quality gates

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (type-aware, via typescript-eslint projectService)
npm run format:check  # prettier --check
npm run format        # prettier --write
```

All three run in CI (`regression.yml`) **before** the browser install, so a style or type break fails in seconds
rather than after a full browser matrix. Current state: **0 errors, 109 warnings**. The warnings are a single
bounded item — `response.json()` returns `any`, so every use of a parsed body trips `no-unsafe-*`. They are left as
visible warnings rather than suppressed with directives: the fix is to type the response bodies, and hidden debt is
worse than counted debt.

Two directories are deliberately excluded from Prettier (`.prettierignore`):

- `ai-agents/personas/` — persona files are prompt text sent to a model verbatim. Their exact wording and layout
  are the interface; reformatting them is an uncontrolled change to a prompt.
- `docs/page-knowledge/` — hand-maintained reference tables whose column alignment is deliberate.

Because `format:check` is a hard gate on the `test` job, and `agent-fixer-verify-and-merge` runs only on
`needs.test.result == 'success'`, both AI writers (`agent-fixer`, `test-evolution`) run `prettier --write` on the
file they generate before committing it. Without that, a model-authored PR would go red on style alone and silently
disable the project's one blocking merge gate.

Dependency updates come through Dependabot (`.github/dependabot.yml`), grouped so a routine week is one PR.
Playwright is deliberately kept **out** of the group — a browser-engine bump is the one update here that can change
test behaviour on its own, so it gets reviewed in isolation. TypeScript major upgrades are ignored: TS 7 moved the
compiler to Go and has no stable programmatic API until 7.1, and `src/test-selection/affected-tests.ts` builds its
import graph on that API, so it needs a planned migration rather than an automated PR.

`.git-blame-ignore-revs` lists the bulk-reformat commit so `git blame` skips it — enable locally with
`git config blame.ignoreRevsFile .git-blame-ignore-revs` (GitHub honours it automatically).

## Project Structure

```
src/
├── core/               config (host/credentials), a FileUtil-style helper, env precheck (global-setup.ts)
├── api/
│   ├── clients/         AuthClient, BookingClient — thin wrappers over the endpoints (APIRequestContext)
│   ├── types/            Booking, CreateBookingResponse, AuthRequest/Response — interfaces, wire field names as-is
│   ├── steps/            AuthSteps, BookingSteps — test.step() wrappers for the report
│   ├── data/              booking.data.ts — test data builders on @faker-js/faker
│   └── auth/              token.provider.ts — a lazily cached token
├── graphql/              GraphQlClient (Hygraph)
├── ui/
│   ├── fixtures.ts        healwright-wrapped `test`/`page` (HealPage), AI model fallback
│   ├── pages/              PracticeFormPage, TextBoxPage, CheckBoxPage, WebTablesPage (Playwright Page objects)
│   └── steps/               ForumSteps, TextBoxSteps, CheckBoxSteps, WebTablesSteps — test.step() wrappers
├── observability/        custom Playwright Reporter — JSONL event log (#2)
├── agent-fixer/           cache-lookup + AI-fallback fix proposer, opens a PR (#3)
├── failure-analysis/       groups failures by cause, retry verdicts, healed-test visibility (#4)
├── test-selection/         TS import-dependency graph → affected specs (#5)
├── jira-triage/            Jira context collection + bug/feature verdict (#6)
├── test-evolution/         AI-generated edge-case test, runs it, proposes a PR only if it passes (#7)
├── goal-evolution/         goal-in-plain-English → agent-written driver, judged by a fixed oracle (#8)
└── ai-agents/              shared CLI fallback, Gemini text/verdict helper, reviewer-tests, qa-analyst (#10)
tests/
├── api/                  auth.spec.ts, booking-crud.spec.ts, negative.spec.ts, book-store-goal.spec.ts (+ test-evolution output)
├── graphql/               positive.spec.ts, negative.spec.ts
└── ui/                    forum.spec.ts, text-box.spec.ts, check-box.spec.ts, buttons-goal.spec.ts, web-tables.spec.ts
docs/
└── page-knowledge/       one markdown file per DemoQA page under test (#9)
ai-agents/
├── personas/             system prompt per AI role — qa-analyst, test-developer, locator-medic, reviewer-tests, goal-solver (#10)
└── profiles/              cheap.env (Claude Sonnet 5 primary, Gemini reserve) / paranoid.env (review tier) (#10)
resources/
├── GQL/                  test GraphQL queries (*.json)
└── files/                 upload-test.txt for the UI test
.github/workflows/
└── regression.yml        test → failure-analysis → Allure/Pages deploy, + jira-triage (PR) and agent-fixer (master)
```

## Endpoint Coverage (REST)

| Endpoint               | What's covered                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth`           | successful and unsuccessful (invalid credentials, empty fields) authentication; on failure the status stays 200, the error is in `reason` |
| `GET /ping`            | service availability (201)                                                                                                                |
| `GET /booking`         | booking list, filtering by `firstname`/`lastname`/`checkin`/`checkout`                                                                    |
| `GET /booking/{id}`    | existing id (200) and non-existent id (404)                                                                                               |
| `POST /booking`        | creation, response body validation, empty body, unicode/special characters, negative `totalprice`, invalid field types                    |
| `PUT /booking/{id}`    | full update with a token (Cookie `token`), without a token (403), with an invalid token (403)                                             |
| `PATCH /booking/{id}`  | partial update                                                                                                                            |
| `DELETE /booking/{id}` | with a token (201), without a token (403), with an invalid token (403)                                                                    |

The auth token is passed on every protected request via **Cookie `token`**, not `Authorization: Bearer`.

`booking-crud.spec.ts` uses a shared fixture booking (`beforeAll`/`afterAll`) and cleans up every booking it created
through a separate `APIRequestContext` created manually (`playwrightRequest.newContext()`) rather than the
worker-scoped `{ request }` fixture — Playwright doesn't allow reusing a test fixture inside `afterAll`.
`negative.spec.ts` cleans up its created bookings after each test via `afterEach`.

## GraphQL and UI

- `positive.spec.ts`/`negative.spec.ts` (graphql) run queries against the public Hygraph demo schema (pagination,
  nested fields, invalid queries) — test queries live in `resources/GQL/*.json`.
- `forum.spec.ts` — an end-to-end scenario filling out and submitting the DemoQA practice form.
- `text-box.spec.ts` — the DemoQA Text Box page: field validation, `#output` rendering quirks.
- `check-box.spec.ts` — the DemoQA Check Box page: tree selection, indeterminate/checked cascade, collapse/expand.

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

There is deliberately no stub test designed to fail on its first attempt just to populate a retry tab in the
report — that would break the "all tests green" guarantee without adding real coverage value. `data: null` in
GraphQL error-validation responses is real Hygraph API behavior (verified with `curl`), hence the assertion
`expect(body.data).toBeNull()` rather than `toBeUndefined()`.

### Code coverage

`npm run coverage` runs the `unit` project under [`c8`](https://github.com/bcoe/c8) (V8-native coverage — no
babel/istanbul instrumentation step, works directly against `tsx`-executed TypeScript) and prints a
statements/branches/functions/lines table, plus an `lcov` report under `coverage/` (gitignored). Only the `unit`
project is instrumented: `api`/`graphql`/`ui` exercise external services (restful-booker, Hygraph, demoqa.com) —
there is no first-party `src/` logic in those runs to hold a coverage number accountable to.

Wired into CI (`regression.yml`'s `test` job) as an informational step that posts the table to the job's step
summary — it runs on every push/PR (`if: always()`, so an unrelated api/ui flake in the same run doesn't hide it)
but is not a merge gate: no minimum threshold is enforced.

**Current: ~66% statements/lines, ~76% branches, ~48% functions** — not evenly spread, and not close to a
number a `--check-coverage` gate could enforce today. `safety-gates.ts` and `classify.ts` sit at 100%;
`test-selection/affected-tests.ts` (29%) and `observability/reporter.ts`/`sanitize.ts` (40–58%) have no unit
test of their own — what little of them shows covered is only the side effect of other tested modules
importing them, or of `reporter.ts` running as a real Playwright reporter during the coverage run itself.
`cli-fallback.ts`/`gemini-text.ts` sit in the middle (42–58%) because their unit tests deliberately cover only
pure helpers (`callerFrom`, parsing) and not the live CLI call paths, which cost real API quota to exercise.
This is the same gap called out in the 2026-09-03 architecture reassessment — `src/` has grown faster than
its test coverage — now with a number attached instead of a LOC-ratio proxy for it.

---

## 1. Self-Healing UI Locators

[Healenium](https://healenium.io) was evaluated for the `ui` project but doesn't fit: its free/OSS proxy only
speaks the Selenium WebDriver protocol, and Playwright doesn't use WebDriver at all. A Playwright integration
exists, but only under Healenium Pro (commercial).

Instead, `ui` uses [healwright](https://github.com/amrsa1/healwright) — an OSS, Playwright-native self-healing
wrapper. When a locator stops matching, it asks an LLM (Anthropic/OpenAI/Google/Ollama) to re-identify the element
from a text description, and caches the healed selector under `.self-heal/` (gitignored) for next time.

- `src/ui/fixtures.ts` extends the base Playwright `test`/`page` fixture with `createHealingFixture()`, typing
  `page` as `HealPage`.
- Page objects use `page.heal.click(locator, "description")` for the most brittle locators — e.g. the
  `react-select`-generated `#react-select-N-option-0` ids, which depend on render order rather than any stable
  attribute.
- If the primary AI model's daily quota is exhausted, `AI_MODEL_FALLBACK` retries once on a second model before
  giving up.

Opt-in via environment variables (see `.env.example`):

```bash
SELF_HEAL=1
AI_PROVIDER=anthropic   # or openai/gpt, google/gemini, local/ollama
AI_API_KEY=...          # not needed for the local/ollama provider
```

Without `SELF_HEAL=1`, `heal.*` calls behave like their plain Playwright equivalents — no AI dependency or extra
latency in normal runs.

> [!NOTE]
> `heal.*` only calls the AI on a cache miss, after a normal Playwright locator attempt has already failed —
> it is not a wrapper that calls AI on every interaction. Wrapping every locator in `heal.*` "just in case" would
> be wrong: healing hides a regression instead of catching it, so only the handful of genuinely brittle locators
> (the `react-select` ids) use it, by deliberate choice.

## 2. AI Observability Layer

Every business action across all three projects already goes through Playwright's `test.step(...)`.
`src/observability/reporter.ts` is a custom Playwright `Reporter` that taps that boundary from the main process —
no changes to any `clients`/`steps`/`pages` file — and writes one append-only JSONL file per run to
`.observability/run-<runId>.jsonl` (gitignored, mirrors `.self-heal/`).

Two record types, discriminated by `type`:

- **`step`** — one per business-level `test.step`, carrying `outcome: "passed" | "failed" |
"passed_with_recovery"` plus a sanitized `error` (ANSI stripped, capped, stack trimmed). `passed_with_recovery`
  is the interesting one: a low-level step failed (e.g. a locator timed out) but the parent `test.step` ultimately
  succeeded — invisible in Allure/HTML today, and exactly what a self-healed locator looks like.
- **`test`** — one per test attempt, with `status`, `outcome` (`flaky` distinguishable from `expected`), and
  `artifacts[]` referencing screenshot/trace/error-context paths (never inlined).

This does **not** ingest `.self-heal/heal_events.jsonl` — they're independent logs, correlated by test name, read
together by failure-analysis rather than merged into one file.

## 3. Agent-Fixer

`src/agent-fixer/` closes the loop the observability layer opens: a locator healwright silently heals at runtime
never turns a test red, so a failure-triggered fixer would rarely catch this class of bug. Instead it reads
`.observability/` for `passed_with_recovery` steps and proposes replacing the broken locator with the working
strategy healwright already found and cached in `.self-heal/healed_locators.json`.

Two layers, in this order:

1. **Deterministic cache lookup** (no AI call) — an exact match against the healwright cache means the fix is a
   fixed template per locator type, not a decision an LLM needs to make.
2. **AI fallback** (the `locator-medic` persona, see [AI Agent Personas](#10-ai-agent-personas)), only when a
   selector has no exact cache match — reads the page object file, edits the broken locator's line, and re-runs
   `npx tsc --noEmit` to confirm it compiles. Runs the shared CLI fallback (Claude → up to 3 Gemini tiers).

Then: creates a branch, commits, pushes, and opens a PR — only if at least one fix was actually applied. In CI
this runs as a separate job gated to successful pushes on `master`; the workflow's own `push`-only trigger means a
fixer PR can never spawn another fixer run.

> [!IMPORTANT]
> The fixer's push and PR use a `FIXER_PAT` secret, not the default `GITHUB_TOKEN` — a PR opened with the default
> token doesn't trigger its own CI run, which would leave a fixer PR unreviewed by a real test run. This is also
> why `test` keeps its default `contents: read` permission and only the `agent-fixer` job carries
> `contents: write`/`pull-requests: write`.

### Risk-tiered auto-merge, circuit breaker, rollback

A fix sourced from the healwright cache (deterministic, runtime-recorded strategy) is eligible for a fully
autonomous path; a fix sourced from the AI fallback (freshly generated code, no runtime evidence) is always held
for human review — decided in `safety-gates.ts`'s `riskTierFor`/`branchFor` and enforced by the pushed branch's
name prefix (`agent-fixer/cache/*` vs `agent-fixer/ai/*`), which is what `regression.yml`'s
`agent-fixer-verify-and-merge` job's trigger actually matches on — see `tests/unit/safety-gates.spec.ts`'s
branch-prefix-agreement tests for the guard keeping the two files in sync. The cache-tier path only merges after
`verify-stability.ts` passes every affected test 5x individually and the affected spec file 2x as a whole, and
only if a git-history-based circuit breaker (any reverted `agent-fixer:` commit, or too many auto-merges in one
window) hasn't tripped. A rollback job auto-reverts and opens a human-owned issue if the full master suite goes
red right after an auto-merge.

> [!NOTE]
> Status as of this writing: the auto-merge path itself has fired once in production (PR #14, cache-tier,
> scoped correctly to the one allowed target file). The circuit breaker and rollback job have not yet been
> exercised by a real trip — no `agent-fixer:` commit has ever needed reverting. Both are covered by unit tests
> of their decision logic (`safety-gates.spec.ts`, `verify-stability.spec.ts`), not by a live incident, so treat
> "written and tested in isolation" and "proven under a real failure" as two different claims until one trips.

## 4. Failure Analysis

`src/failure-analysis/` groups failed tests by a normalized error signature into one of five causes — `config`,
`ai-quota`, `ai-healing`, `assertion`, `other` — and states a retry verdict per cause (e.g. "retrying a config
error never helps, budget should be 0"; "retrying an assertion failure is the right way to tell flake from a real
bug"). It's a stated policy today, not a dynamic retry-count controller — see [Smart Retry](#not-yet-built) below.

It also surfaces tests that only passed because of a silent AI recovery: an `environment.properties` counter on
the Allure Overview page, plus a per-test tag, so a "self-healed" pass is visibly different from an honest one.

### AI verdict modules

Two standalone, callable modules layer an AI verdict on top of the rule-based grouping above — each one call
per event, via `gemini-text.ts`'s `callGemini`, with its own persona file:

- **`healing-classify.ts`** (`ai-agents/personas/healing-classifier.md`) — takes one `passed_with_recovery`
  `RecoverySummary` (original locator, failure log, healed locator) and returns `STRUCTURAL` / `TIMING` /
  `DYNAMIC_ID` plus a suggested action (`PROPOSE_FIX` / `INCREASE_TIMEOUT` / `IGNORE_TEMPORARY_FLAKE`). Answers
  _why_ a locator broke, which `summarizeRecoveries()` above deliberately doesn't — a `TIMING` verdict means the
  code must NOT change (a `waitFor`/timeout fix instead), so this is meant to gate agent-fixer from "fixing" a
  locator that was never actually wrong.
- **`retry-dispatch.ts`** (`ai-agents/personas/retry-dispatcher.md`) — takes one failed `TestSummaryEvent` and
  returns a category (`CONFIG_ERROR` / `INFRA_FLAKE` / `ASSERTION_FAILURE` / `AI_QUOTA_EXHAUSTED`),
  `shouldRetry`, and a `retryBudget`. Deliberately separate from the rule-based `RETRY_VERDICTS` table above,
  not a replacement for it — different category set (adds `INFRA_FLAKE`, which the rule-based table has no
  equivalent for) and a per-call AI verdict instead of a fixed prose policy.

Both are pure verdict functions (`classifyRecovery(recovery)`, `dispatchRetry(test)`). They share one JSON
unwrapper (`src/ai-agents/json-response.ts`, covered by `json-response.spec.ts`) — models wrap a "JSON only"
reply in a ```json fence often enough that each caller re-implementing that tolerance is how two call sites
drift apart. Shape validation is unit-tested per module (`healing-classify.spec.ts`, `retry-dispatch.spec.ts`).

`dispatchRetry` is called from `run.ts`, but **only for failure groups the rule-based classifier labelled
`other`** — the one category where the static table admits it has no policy. Paying for a model call on a
`config` failure would buy an answer the table already states with certainty. Its verdict is printed beside the
rule-based one and marked advisory: nothing branches on it, and it cannot influence retries (see the Playwright
constraint under "Not yet built"). A failed call logs to stderr and leaves the deterministic report intact.

`classifyRecovery` has no caller yet — it is meant to gate agent-fixer, which means wiring it in changes what
gets auto-merged, so it stays uncalled until that gate is designed deliberately rather than by import.

## 5. Affected-Test Selection

```bash
npm run test:affected
```

`src/test-selection/` builds a real TypeScript import-dependency graph from every `tests/**/*.spec.ts` file
(resolving `tsconfig.json`'s `paths` aliases), diffs the current branch against `master` (or `origin/<base>` in
CI), and runs only the specs whose dependency set actually contains a changed file.

Anything the import graph can't reason about — `playwright.config.ts`, `tsconfig.json`, `package.json`,
`package-lock.json`, `.github/workflows/**` — falls back to running the full suite.

In CI, `pull_request` runs use `test:affected`; `push` to `master` and manual `workflow_dispatch` runs always run
the full suite — a false negative reaching `master` unnoticed is the one outcome this must never risk.

## 6. Jira-Driven Red-Test Triage

```bash
npm run jira-triage [observability-run-file]   # defaults to the latest .observability/run-*.jsonl
```

When an assertion fails (not a broken locator — that's healwright's job), it isn't always clear whether that's a
real bug or the expected result of a feature change already described in Jira. `src/jira-triage/`:

- Parses a Jira key from the current branch name and fetches that ticket's summary, description, and every
  comment.
- If the ticket alone looks thin, walks up to the parent Story: its description, then every sibling subtask's
  summary/description (one JQL call, not a project-wide search).
- Fetches a sibling's comments only when a relevance check says it's related to the failing area.
- Combines the failing step with the collected context into one verdict call — YES (Jira describes a change that
  explains this failure) or NO (likely a real bug), with a stated reason.

Authenticates against the Jira Cloud REST API directly with an Atlassian API token (`JIRA_EMAIL`/`JIRA_API_TOKEN`/
`JIRA_BASE_URL`) — headless, not the OAuth-based `mcp__atlassian__*` tools a chat session uses. Create a token at
https://id.atlassian.com/manage-profile/security/api-tokens.

> [!IMPORTANT]
> This is not a stylistic choice — `mcp__atlassian__*` tools only exist inside an interactive Claude Code chat
> session. Their OAuth login (`claude mcp login atlassian`) needs a real terminal to complete a browser-based
> auth flow, and the tools themselves are a protocol between Claude Code and an MCP server, not a plain HTTP API
> callable from anywhere. A GitHub Actions runner is neither — it's a headless `node`/`tsx` process with no
> Claude Code, no MCP server, no interactive stdin. A static API token stored as a GitHub secret is the only
> option that actually works there.

In CI, gated to `pull_request` events, as a separate job from `test`.

**Gap: does not act on a YES verdict yet** — no fix generation, no PR. That's Intent-Based Testing (search for a
new path toward the ticket's described goal, instead of patching the old assertion) — planned, not built.

## 7. Self-Evolving Test Suite

```bash
npm run test-evolution
```

`src/test-evolution/` asks an AI (the `test-developer` persona, see
[AI Agent Personas](#10-ai-agent-personas)) to propose one new edge-case API test from an existing reference spec,
actually runs the generated test, and only commits + opens a **Draft** PR if it demonstrably passes — a generated
test that fails is discarded, never proposed. The PR body includes the real test titles (parsed from the generated
file, not re-summarized), a results table read from the observability log, and a `reviewer-tests` verdict.

Generation runs the shared CLI fallback: Claude CLI (Sonnet 5, `--effort medium`) primary → up to three Gemini
tiers, only falling through to Gemini if Claude itself fails. Claude authenticates through the existing Claude
Code subscription session — no separate paid API key needed.

> [!NOTE]
> The Claude CLI tier (`claude -p ...`) is unrelated to healwright's own AI calls. Healwright's `AnthropicProvider`
> uses the official `@anthropic-ai/sdk` directly (`new Anthropic({ apiKey })`), which requires a paid
> `ANTHROPIC_API_KEY` — the CLI subprocess approach used here instead authenticates through whatever Claude Code
> session is already logged in, with no separate key. The two are not interchangeable; see
> [Not yet built](#not-yet-built) for why healwright itself doesn't get this same fallback.

**Gap: no CI job** — unlike the other AI modules, this only runs when invoked manually (`npm run test-evolution`),
not wired into `regression.yml` yet.

## 8. Goal-Based Tests

```bash
npm run goal-evolution -- <goal-id>   # buttons-dynamic-click | book-store-register-user (default: buttons-dynamic-click)
```

`src/goal-evolution/` is a different kind of test authoring than [Self-Evolving Test
Suite](#7-self-evolving-test-suite): instead of asking an AI to write a whole test in one shot, it gives an AI a
**goal in plain English** — no steps, no locators, and (for `book-store-register-user`) not even which layer
(UI vs. API) to use — and lets it work out how to reach it from a [page-knowledge](#9-page-knowledge-cache) file
alone (it has no browser or network access of its own).

The `goal-solver` persona (extends `test-developer`, see [AI Agent Personas](#10-ai-agent-personas)) only ever
writes a client/Page Object plus one exported `achieve(...)` driver function — never a spec file, never an
`expect(...)` call. The success check (`Goal.succeedsWhen`) is written by a human ahead of time, lives in a `Goal`
definition (`src/goal-evolution/goals/*.ts`) the agent never sees, and runs from a human-owned spec file
(`tests/{ui,api}/*-goal.spec.ts`) right after `achieve()` returns, in the same context (`Page` for a UI goal,
`APIRequestContext` for an API goal — `Goal<TCtx>` is generic over this). This split exists because an agent's own
belief that it "achieved the goal" isn't evidence of anything — only a fixed, human-authored assertion the agent
couldn't influence is.

`src/goal-evolution/run.ts` also runs one narrow contract check per goal (`Goal.contractChecks`) on the generated
driver — e.g. for `buttons-dynamic-click`, the "Click Me" button's `id` is regenerated on every page load, so a
driver that hardcoded it would pass once and rot on the next run; for `book-store-register-user`, the driver must
accept the username as a parameter rather than hardcoding one, so the harness (not the driver) controls the
identity the oracle checks — before compiling and running the oracle spec.

**Stopping and reporting when a goal can't be reached.** A goal fails to resolve for one of three distinct
reasons, and `run.ts` reports which: (1) generation itself hangs — bounded by a per-attempt wall-clock timeout on
the Claude CLI call (`ATTEMPT_TIMEOUT_MS`, via `cli-fallback.ts`'s `CliTimeoutError` — a timeout is re-thrown
immediately rather than silently falling through to the Gemini fallback tiers, so it isn't misreported as "the
model failed"); (2) the driver comes back but violates its contract (writes its own `expect(...)`, hardcodes an
identity) — not retried, since a second generation attempt is unlikely to fix a rule violation differently; (3)
the driver is clean but the **oracle** fails — retried up to `MAX_ATTEMPTS` (2, kept low deliberately: each
`book-store-register-user` attempt registers a real user on demoqa.com), and the final report explicitly points at
the goal's `pageKnowledgeFile` as the likely cause, since a clean driver failing the oracle repeatedly is usually
the page-knowledge file being wrong or stale, not an agent mistake.

**Two goals, two things each proves:**

- `buttons-dynamic-click` (UI) — the agent has to infer a _locator strategy_ from a behavior note (an id that's
  regenerated on every page load), not just copy a locator out of the page-knowledge table.
- `book-store-register-user` (API) — a differently-shaped claim, calibrated deliberately: `docs/page-knowledge/
book-store-register.md` documents _two_ possible paths (a CAPTCHA-blocked UI form, and a working REST endpoint)
  and states outright which one is achievable — the agent isn't deriving that conclusion from raw evidence, it's
  reading a conclusion a human already reached and correctly acting on it: choosing the API layer, writing the
  client in the existing `booking.client.ts` shape, and never touching the UI form. The goal description itself
  still never says "use the API" — only the page-knowledge file does. The oracle re-derives proof of registration
  independently (`GenerateToken` + a duplicate-registration check) rather than trusting the driver's own response,
  and the spec cleans up the created user via `DELETE` in a `finally` block (confirmed live: cleanup logs the
  actual `DELETE` response status, not just "it ran").

> [!NOTE]
> This is a **demo-scale example**, not a general framework: two goals, two target pages/endpoints deliberately
> chosen to have no existing Page Object/client, no CI wiring, no branch/PR flow like `test-evolution` has.
> Runtime goal execution (an agent driving the browser/API live on every test run, rather than resolving the goal
> once into a deterministic spec) was considered and rejected — it would reintroduce AI into the decisive path of
> every CI run, which is the opposite of what this framework is trying to move away from.

## 9. Page Knowledge Cache

`docs/page-knowledge/` holds one markdown file per DemoQA page under test — locators, id/label mismatches, and
non-obvious behavior discovered the first time that page was explored in a browser. Committed to the repo, not
gitignored: this documents facts about the site's structure, not per-machine ephemeral state.

Workflow: before opening a browser for a new ticket on a page, check whether its file already exists and answers
what's needed — write the page object/test straight from it. Open the browser only for what the file doesn't
cover, then update the file as part of the same commit.

No staleness tracking — the file is trusted fully; a browser check only happens on a genuine cache miss (a test
failure on a documented locator), never on a schedule.

> [!WARNING]
> This is a deliberate trade-off, not an oversight: if the live DemoQA site changes its DOM structure, nothing
> here detects that proactively. The only signal is a test failing against a locator the cache says should still
> work — that failure is the trigger to go re-verify and update the file, not a background check catching it
> earlier.

## 10. AI Agent Personas

`ai-agents/` standardizes the AI roles that were previously inline prompt strings scattered across
`test-evolution`/`agent-fixer` — same underlying behavior, one place to read/edit what each role is
instructed to do, plus one genuinely new gate (`reviewer-tests`).

```
ai-agents/
├── personas/            one markdown file per role — the system prompt, read at runtime
│   ├── qa-analyst.md      reads a requirement, writes a scenario checklist (no code)
│   ├── test-developer.md  writes test code — hard rule: only existing Page Objects/clients/steps,
│   │                      never a new abstraction (was test-evolution's inline prompt)
│   ├── locator-medic.md   fixes one broken locator in source (was agent-fixer's inline prompt)
│   └── reviewer-tests.md  read-only architecture/style review, VERDICT/REASON output
└── profiles/             env files controlling which model tier a role runs on
    ├── cheap.env           generation tier: Claude (Sonnet 5, --effort medium) writes first; three
    │                       Gemini models (AI_AGENTS_MODEL/_FALLBACK/_FALLBACK_2, separate from
    │                       healwright's AI_MODEL) are reserve-only, reached only if Claude fails —
    │                       each can optionally get its own API key (AI_AGENTS_GEMINI_API_KEY[_FALLBACK[_2]],
    │                       set in .env) for cross-project quota independence, confirmed live: a
    │                       call on one key's short-window limit didn't affect the very next call
    │                       on a different key
    └── paranoid.env         review tier: same provider (Claude) as generation, but HIGHER effort
                             (AI_REVIEW_CLAUDE_EFFORT=high vs. generation's medium) — a review at
                             the same effort as generation defeats the point of a paranoid pass
```

| Persona          | Lives in                               | Wired into                                                                                                                                              |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-developer` | `src/test-evolution/propose-test.ts`   | `npm run test-evolution`                                                                                                                                |
| `locator-medic`  | `src/agent-fixer/fix-proposer.ts`      | `npm run agent-fixer` (layer 2, cache-miss fallback)                                                                                                    |
| `reviewer-tests` | `src/ai-agents/reviewer-tests.ts`      | `npm run test-evolution`, as a second gate after the generated test already passed a real run                                                           |
| `goal-solver`    | `src/goal-evolution/propose-driver.ts` | `npm run goal-evolution` — extends `test-developer`, resolves a plain-English goal into a driver, never writes the oracle                               |
| `qa-analyst`     | `src/ai-agents/qa-analyst.ts`          | `npm run qa-analyst -- <requirement-file>` — standalone, not wired into CI (a requirement has no fixed file location the way an observability run does) |

> [!IMPORTANT]
> `reviewer-tests` is **advisory, not a gate that blocks the PR** — a CLI/API failure here falls through to
> "proceed without a review verdict" rather than discarding an already-verified-passing test. The point is a
> second opinion from a different model tier surfaced in the PR body, not a second pass/fail hurdle a flaky review
> call could block on.

> [!NOTE]
> Two source files were renamed, not duplicated, during this standardization: `src/jira-triage/gemini-verdict.ts`
> moved to `src/ai-agents/gemini-text.ts` (the shared plain-text/verdict Gemini call helper, now parameterized by
> model pair instead of hardcoded to `AI_MODEL`/`AI_MODEL_FALLBACK`, so `reviewer-tests` can run on a different
> tier than generation). `jira-triage` itself is unchanged — same behavior, updated import path.

A fifth file, `ai-agents/personas/reporter.md`, documents the rendering contract both `failure-analysis` and
`test-evolution` already follow (results table shape, "every claim cites its observability source") — it's read
by a human maintaining either module, not loaded by any script at runtime; there's no separate `reporter` code
path to wire in, since both callers already produce markdown in this shape.

## Not yet built

- **Retry verdicts as a real lever** — the verdicts are produced and reported (rule-based per category, plus an
  AI advisory verdict for uncategorized causes), but nothing turns them into an actual retry decision, and this
  is a Playwright constraint rather than missing work: `retries` is a static per-project number read before the
  run starts, and there is no per-attempt hook to grant or deny a retry based on why the previous attempt failed.
  The reachable version of this idea is not a per-test budget but a **fail-fast run abort** — on a `CONFIG_ERROR`
  or `AI_QUOTA_EXHAUSTED` verdict, stop the whole run instead of spending the full retry budget on every
  remaining test to rediscover the same missing env var. That is buildable today with `maxFailures`; a genuine
  per-test dynamic budget would require replacing the runner, which is not worth it for this framework.
- **A reason-check gate before agent-fixer promotes a heal to permanent code** — today a `passed_with_recovery`
  step goes straight to a cache-lookup/AI-proposed fix with no check on _why_ the original locator broke: a
  slow-to-render element (a timing issue — the real fix is a wait, not a new selector) and an actual structural
  DOM change both look identical to agent-fixer today. Should classify the reason before committing a fix, not
  just cache the result and move on.
- **Intent-Based Testing + draft PR on a jira-triage verdict** — jira-triage stops at reporting the verdict. If
  this is ever built, the generated PR must stay **draft and never auto-merge**, unlike agent-fixer's cache tier:
  agent-fixer replaces a _locator_ against a fix healwright already exercised at runtime, whereas this would edit
  an _assertion_ — and an AI that rewrites a failing assertion until the test passes is indistinguishable, from
  the outside, from one that fixed a genuinely outdated expectation. That is the same hole `reviewer-tests`
  check #3 (assertion honesty) exists to catch, so a human has to be the one who merges it.
- **CI enforcement for the page-knowledge convention** — no lint/CI check that the doc was updated alongside test
  code; it's a discipline convention, not an enforced one.
- **Page-knowledge coverage** — five pages are documented (Text Box, Check Box, Buttons, Book Store Register, Web
  Tables); the rest of the DemoQA pages haven't been explored yet.

## Reports

Playwright collects its built-in HTML report and `allure-playwright` results at the same time:

```bash
  npm test
  npm run report            # open the Playwright HTML report
  npm run allure:generate   # build a static Allure report from allure-results/
  npm run allure:serve      # build and immediately open the Allure report
```

In CI, the Allure report is published to GitHub Pages after every `push`/`workflow_dispatch` run against `master`
(skipped, not failed, on PR runs — GitHub Pages environment protection rejects deploys from a PR merge ref).

> [!NOTE]
> A downloaded Allure report shows "500 Failed to fetch" on every widget if opened directly as a local
> `index.html` file — the report fetches sibling JSON files at runtime, and browsers block `fetch()` under the
> `file://` protocol. Serve it over HTTP instead (e.g. `npx http-server` in the extracted folder, or just use the
> live GitHub Pages URL, which is already HTTP).
