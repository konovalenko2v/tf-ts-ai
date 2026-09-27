// Human-owned. The agent (goal-solver persona, src/goal-evolution/propose-driver.ts) never edits
// this file and never sees it — its output scope is src/ui/pages/alerts.page.ts only. This file
// is the only place the goal's oracle (alertsConfirmGoal.succeedsWhen) actually runs, in the same
// page context right after the agent-written achieve(page) returns. See src/goal-evolution/goal.ts
// for why this split is what makes the goal-based result trustworthy instead of self-reported.

import { test } from '../../../src/ui/fixtures';
import { achieve } from '../../../src/ui/pages/alerts.page';
import { alertsConfirmGoal } from '../../../src/goal-evolution/goals/alerts-confirm';

test.describe('DemoQA UI @ Alerts (goal-based)', () => {
  test(alertsConfirmGoal.id, async ({ page }) => {
    // achieve() owns navigation itself (the agent's driver called page.goto internally) — this
    // spec only checks the oracle after.
    await achieve(page);

    await alertsConfirmGoal.succeedsWhen(page);
  });
});
