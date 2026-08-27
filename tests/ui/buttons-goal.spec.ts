// Human-owned. The agent (goal-solver persona, src/goal-evolution/propose-driver.ts) never edits
// this file and never sees it — its output scope is src/ui/pages/buttons.page.ts only. This file
// is the only place the goal's oracle (buttonsDynamicClickGoal.succeedsWhen) actually runs, in the
// same page context right after the agent-written achieve(page) returns. See src/goal-evolution/goal.ts
// for why this split is what makes the goal-based result trustworthy instead of self-reported.

import { test } from '../../src/ui/fixtures';
import { achieve } from '../../src/ui/pages/buttons.page';
import { buttonsDynamicClickGoal } from '../../src/goal-evolution/goals/buttons-dynamic-click';

test.describe('DemoQA UI @ Buttons (goal-based)', () => {
  // Title is the goal's short id, not its full prose description — a Playwright/Allure test title
  // should read as a test name, not as the prompt that was given to the agent. The full goal
  // description lives in src/goal-evolution/goals/buttons-dynamic-click.ts.
  test(buttonsDynamicClickGoal.id, async ({ page }) => {
    await page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());

    // achieve() owns navigation itself (the agent's driver called page.goto internally) — this
    // spec only sets up ad-blocking before it and checks the oracle after.
    await achieve(page);

    await buttonsDynamicClickGoal.succeedsWhen(page);
  });
});
