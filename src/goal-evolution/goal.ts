// A Goal is the unit this module operates on: plain-English intent for the agent, plus a fixed
// oracle the agent never writes and can't influence. This split is the entire point — see README
// "Goal-Based Tests" for why an agent's own "I achieved the goal" is not evidence of anything.
//
// Generic over the context succeedsWhen runs with (TCtx) — a UI goal needs a Page, an API goal
// needs an APIRequestContext plus whatever identity the harness generated. Deliberately just one
// type parameter, not a UiGoal/ApiGoal class hierarchy — the shape (description + oracle +
// contract check) is identical either way, only the context differs.
//
// The agent never writes the spec/test file or any assertion at all: it only ever writes a
// client-or-page + one exported driver function that performs whatever sequence it decided
// accomplishes the goal. The human-owned spec (tests/**/*-goal.spec.ts) calls that driver, then
// calls succeedsWhen in the SAME context right after — so it's checking real post-action state,
// not a claim the generated code makes about itself. This is a prose boundary (the persona's
// stated output contract), not a filesystem sandbox — cli-fallback.ts's DEFAULT_PROFILE grants
// Read/Write/Edit with no path restriction — so a reviewer must actually check the agent stayed
// in scope, same as any other generated-code review (see goal-runner.ts's contract checks).
//
// For an API goal specifically: the harness — not the driver — must generate any identity
// (username, id, etc.) the oracle later verifies. If the driver were allowed to choose and return
// its own identity, a driver that silently swallowed a failure (e.g. a 406 "User exists!") could
// still pass by handing the oracle a pre-existing record it didn't actually create. Passing a
// harness-generated, guaranteed-fresh identity into the driver closes that gap.

export interface Goal<TCtx> {
  /** Short id used for file naming and as the Playwright test title (keeps Allure/observability readable). */
  id: string;
  /** Plain-English description the agent receives — deliberately no steps, no locators, and no mention of which layer (UI/API) to use unless that's part of the goal itself. */
  description: string;
  /** Page-knowledge file (relative to repo root) the agent should read before writing anything. */
  pageKnowledgeFile: string;
  /** Repo-relative path to the driver module the agent must create. Passed into the prompt. */
  driverFile: string;
  /**
   * The exact TypeScript signature achieve(...) must have, spelled out in plain English for the
   * prompt (e.g. "achieve(page: HealPage): Promise<void>" or "achieve(request: APIRequestContext,
   * userName: string, password: string): Promise<string | undefined> — the created user's id, or
   * undefined if creation failed"). Learned the hard way: leaving this to the agent's judgment
   * ("match the parameter list to the layer you chose") got the parameters right but the RETURN
   * type wrong twice in a row for book-store-register-user — the agent returned the raw
   * APIResponse instead of extracting userId, which the human-owned spec assigns to a `string |
   * undefined` variable. tsc caught it both times (the pipeline's compile step did its job), but
   * an underspecified prompt turned "the agent solved it wrong" into "the agent was never told
   * the actual contract" — not a finding about goal-resolution, just an ambiguous instruction.
   */
  achieveSignature: string;
  /**
   * The fixed success oracle. Written by a human ahead of time, never generated or editable by
   * the agent. Called by the human-owned spec file right after the agent-written driver returns.
   */
  succeedsWhen: (ctx: TCtx) => Promise<void>;
  /**
   * Optional goal-specific static check on the generated driver source, beyond the universal
   * "no expect(...) call" check every goal gets in run.ts. Narrow and honest, not a general
   * analyzer — see buttons-dynamic-click.ts's id-hardcoding check for the pattern.
   */
  contractChecks?: (source: string) => string[];
}
