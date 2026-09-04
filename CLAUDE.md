# CLAUDE.md — index

AI-native QA framework: Playwright/TypeScript tests (REST, GraphQL, UI) plus a set of AI modules
around them (self-healing, observability, fixers, triage, test generation). Full feature
descriptions live in `README.md` — this file is routing only, for a cold agent session. Do not
duplicate README content here; link to its section (`README.md#N`) instead.

## Where things live

| Task involves...                                     | Look at                                                                                                                                  | Details                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| REST tests (Restful Booker)                          | `src/api/` (clients/types/steps/data/auth), `tests/api/*.spec.ts`                                                                        | README §"Endpoint Coverage" |
| GraphQL tests (Hygraph)                              | `src/graphql/`, `tests/graphql/*.spec.ts`, `resources/GQL/*.json`                                                                        | README §"GraphQL and UI"    |
| UI tests (DemoQA)                                    | `src/ui/` (fixtures.ts, pages/, steps/), `tests/ui/*.spec.ts`                                                                            | README §1                   |
| Self-healing locators (healwright)                   | `src/ui/fixtures.ts`                                                                                                                     | README §1                   |
| Observability / JSONL run logs                       | `src/observability/reporter.ts`, `.observability/*.jsonl` (gitignored)                                                                   | README §2                   |
| Agent-Fixer (locator fix → PR)                       | `src/agent-fixer/`                                                                                                                       | README §3                   |
| Failure Analysis (cause grouping, retry verdicts)    | `src/failure-analysis/`                                                                                                                  | README §4                   |
| Affected-test selection                              | `src/test-selection/`                                                                                                                    | README §5                   |
| Jira red-test triage                                 | `src/jira-triage/`                                                                                                                       | README §6                   |
| Self-evolving test suite (new edge-case test → PR)   | `src/test-evolution/`                                                                                                                    | README §7                   |
| Goal-based tests (prose goal → agent-written driver) | `src/goal-evolution/` (`goal.ts`, `goals/*.ts`, `run.ts`, `propose-driver.ts`)                                                           | README §8                   |
| Page-knowledge cache (per-page DOM/behavior notes)   | `docs/page-knowledge/*.md` — currently `text-box.md`, `check-box.md`, `buttons.md`, `book-store-register.md`, `book-store-list.md`, `web-tables.md` | README §9                   |
| AI personas / model tiers                            | `ai-agents/personas/*.md` (system prompts), `ai-agents/profiles/{cheap,paranoid}.env`, `src/ai-agents/cli-fallback.ts`, `gemini-text.ts` | README §10                  |
| Env vars / config                                    | `src/core/config.ts`, `src/core/global-setup.ts` (fails fast on missing vars), `.env.example` (full inventory)                           | —                           |
| CI pipeline                                          | `.github/workflows/regression.yml`                                                                                                       | —                           |

Personas on disk: `qa-analyst`, `test-developer`, `locator-medic`, `reviewer-tests`, `goal-solver`
(extends `test-developer`), `reporter` (docs-only convention, not loaded at runtime).

## Key npm scripts

```bash
npm test                       # full suite (api + graphql + ui projects)
npm run test:api / :graphql / :ui
npm run test:affected          # only specs a local diff can affect (vs master / origin/<base>)
npm run coverage               # c8 statement/branch coverage over the unit project (informational, not a gate)
npm run report                 # Playwright HTML report
npm run allure:generate / allure:serve

npm run agent-fixer            # heal cache -> source-code fix -> PR
npm run failure-analysis       # cause grouping + retry verdicts from an observability run
npm run test-evolution         # AI proposes + runs + PRs one new edge-case test
npm run goal-evolution -- <goal-id>   # buttons-dynamic-click | book-store-register-user
npm run jira-triage [observability-run-file]   # defaults to latest .observability/run-*.jsonl
npm run qa-analyst -- <requirement-file>
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
5. **Check `docs/page-knowledge/<page>.md` before opening a browser** for a new UI ticket. Write
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
