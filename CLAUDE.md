# CLAUDE.md — index

AI-native QA framework: Playwright/TypeScript tests (REST, GraphQL, UI) plus a set of AI modules
around them (self-healing, observability, fixers, test generation). Full feature descriptions
live in `README.md` — this file is routing only, for a cold agent session. Do not duplicate
README content here; link to its section (`README.md#N`) instead.

**claude-only-edition**: this branch runs on the Claude Code CLI subscription only — no Gemini
key, no paid Anthropic API key, no other subscription. Self-healing uses a local Ollama model
(`AI_PROVIDER=local`) instead of a cloud provider. Jira-driven red-test triage and the old
Gemini-backed `pr-review`/`jira-triage`/AI-fallback CI gates were removed rather than ported —
see README's "claude-only-edition" note for what changed and why.

## Where things live

| Task involves...                                                                   | Look at                                                                                                                                                                    | Details                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| REST tests (Restful Booker)                                                        | `src/api/` (clients/types/steps/data/auth), `tests/api/*.spec.ts`                                                                                                          | README §"Endpoint Coverage" |
| GraphQL tests (Hygraph)                                                            | `src/graphql/`, `tests/graphql/*.spec.ts`, `resources/GQL/*.json`                                                                                                          | README §"GraphQL and UI"    |
| UI tests (DemoQA)                                                                  | `src/ui/` (fixtures.ts, pages/, steps/), `tests/ui/*.spec.ts`                                                                                                              | README §1                   |
| Self-healing locators (healwright)                                                 | `src/ui/fixtures.ts`                                                                                                                                                       | README §1                   |
| Observability / JSONL run logs                                                     | `src/observability/reporter.ts`, `.observability/*.jsonl` (gitignored)                                                                                                     | README §2                   |
| Agent-Fixer (locator fix → PR)                                                     | `src/agent-fixer/`                                                                                                                                                         | README §3                   |
| Failure Analysis (cause grouping, retry verdicts, flaky-test quarantine detection) | `src/failure-analysis/` (incl. `quarantine.ts`, `check-quarantine-ttl.ts`)                                                                                                 | README §4                   |
| Affected-test selection                                                            | `src/test-selection/`                                                                                                                                                      | README §5                   |
| Self-evolving test suite (new edge-case test → PR)                                 | `src/test-evolution/`                                                                                                                                                      | README §6                   |
| Goal-based tests (prose goal → agent-written driver)                               | `src/goal-evolution/` (`goal.ts`, `goals/*.ts`, `run.ts`, `propose-driver.ts`)                                                                                             | README §7                   |
| Page-knowledge cache (per-page DOM/behavior notes)                                 | `docs/page-knowledge/*.md` — currently `text-box.md`, `check-box.md`, `buttons.md`, `book-store-register.md`, `book-store-list.md`, `book-store-login.md`, `web-tables.md` | README §8                   |
| AI personas / model tiers                                                          | `ai-agents/personas/*.md` (system prompts), `ai-agents/profiles/{cheap,paranoid}.env`, `src/ai-agents/cli-fallback.ts`                                                     | README §9                   |
| PR review (whole-diff review, local pre-push step, not a CI gate)                  | `src/ai-agents/pr-reviewer.ts`, `ai-agents/personas/pr-reviewer.md`, shared verdict grammar in `src/ai-agents/review-verdict.ts`                                           | README §10                  |
| Env vars / config                                                                  | `src/core/config.ts`, `src/core/global-setup.ts` (fails fast on missing vars), `.env.example` (full inventory)                                                             | —                           |
| CI pipeline                                                                        | `.github/workflows/regression.yml`                                                                                                                                         | —                           |
| Secret scanning (blocking gate)                                                    | `secret-scan` job in `regression.yml` (gitleaks)                                                                                                                           | —                           |

Personas on disk (6): `test-developer`, `locator-medic`, `reviewer-tests`, `pr-reviewer`,
`goal-solver` (extends `test-developer`), `reporter` (docs-only convention, not loaded at runtime).
All but `reporter` are read at runtime — `ls ai-agents/personas/` is the source of truth if this
line goes stale. (`qa-analyst`, `healing-classifier`, `retry-dispatcher` were removed along with
their Gemini-backed modules — see the claude-only-edition note above.)

Two distinct review personas, easy to confuse: `reviewer-tests` judges ONE generated test file
inside `test-evolution` and is advisory; `pr-reviewer` judges a WHOLE PR diff and, when run,
recommends blocking on a `major` finding. They share one output grammar
(`src/ai-agents/review-verdict.ts`) — extend that module, never fork a second copy of the parser.

## Key npm scripts

```bash
npm test                       # full suite (api + graphql + ui projects)
npm run test:api / :graphql / :ui
npm run test:affected          # only specs a local diff can affect (vs master / origin/<base>)
npm run coverage               # c8 statement/branch coverage over the unit project (informational, not a gate)
npm run report                 # Playwright HTML report
npm run allure:generate / allure:serve

npm run agent-fixer            # heal cache -> source-code fix -> PR
npm run failure-analysis       # cause grouping + retry verdicts + quarantine-candidate detection
npm run check-quarantine-ttl   # CI gate: fails if a quarantine.json entry is past its TTL
npm run test-evolution         # AI proposes + runs + PRs one new edge-case test
npm run goal-evolution -- <goal-id>   # buttons-dynamic-click | book-store-register-user | book-store-remove-books
npm run pr-review -- <pr-number>       # whole-diff PR review; local step, run before pushing/merging
```

## Critical rules

1. **Headless Playwright, never `claude-in-chrome`, for anything test-related.** Driving the
   user's real browser session to inspect a page or verify a test is forbidden — use
   `chromium.launch({ headless: true })` or an ad-hoc script instead. See
   `ai-agents/personas/test-developer.md` (hard rule, also reinforced in `goal-solver.md`).
2. **Never write a new abstraction from scratch.** Reuse existing `clients`/`steps`/`pages` —
   e.g. reach for `src/api/auth/token.provider.ts`, don't fetch a token yourself. See
   `ai-agents/personas/test-developer.md` ("Hard rule").
3. **goal-evolution has a strict agent/oracle split.** The agent (`goal-solver`) writes only a
   client/Page Object + `achieve(...)` — never a spec file, never `expect(...)`. The success
   condition (`Goal.succeedsWhen`) is human-written ahead of time in `src/goal-evolution/goals/*.ts`
   and the agent never sees it. See `ai-agents/personas/goal-solver.md`.
4. **Nothing hardcoded.** All credentials/keys/tokens come from `.env` (gitignored); `.env.example`
   lists every variable the project reads. `src/core/global-setup.ts` fails fast with a clear
   message on a missing required var rather than silently falling back.
5. **An AI review never fails on its own infrastructure.** `pr-reviewer` exits non-zero ONLY on a
   `major` finding; the `claude` CLI not being installed/authenticated or an unparseable reply
   exit 0 with a loud "review unavailable" comment. Those are facts about the infrastructure, not
   the PR — and a check that goes red for reasons the author can't act on is one people learn to
   ignore (or bypass with `--no-verify`, if this is ever wired into a pre-push hook). Keep that
   split if you touch `src/ai-agents/pr-reviewer.ts`.
6. **Check `docs/page-knowledge/<page>.md` before opening a browser** for a new UI ticket. Write
   the page object/test from the file if it already answers what's needed; update the file in the
   same commit if you had to explore live.

## Other notes

- `CLAUDE.local.md` (gitignored, not checked in) holds session-specific working notes/decisions —
  check it for recent context this file doesn't carry.
- Counts of files in `docs/page-knowledge/` appear in both this file and README's "Not yet built"
  section. Both were stale before and have been corrected to five; still trust the directory
  listing over either prose claim, since a new page gets documented more often than these lines
  get updated.
- `npm run lint` / `format:check` / `typecheck` are hard CI gates. Both AI writers (`agent-fixer`,
  `test-evolution`) therefore run `prettier --write` on the file they generate before committing —
  do not remove that step, or every AI-authored PR goes red on style and the auto-merge path
  silently stops firing.
