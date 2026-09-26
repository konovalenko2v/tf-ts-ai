// Opt-in only — gated in playwright.config.ts's `ui` project testIgnore behind DEMO_FAILURE, never
// runs in CI or a normal local `npm test`. Exists purely to show a red test through the whole
// pipeline (Playwright HTML, Allure, ReportPortal, this project's own dashboard) for a
// presentation/demo, without leaving a permanently-failing test on master that would block the
// required `test` check and agent-fixer-verify-and-merge on every push.
//
// Deliberately fails on a WRONG EXPECTED VALUE inside an existing verify* step
// (TextBoxSteps.verifyOutput), not a missing/broken locator — a locator miss would route through
// healwright's AI self-healing fallback (real quota spend, and a candidate for agent-fixer to
// "fix"), which is not what a demo failure is for.
import { test } from '../../src/ui/fixtures';
import { TextBoxSteps } from '../../src/ui/steps/text-box.steps';

test.describe('DemoQA UI @ Text Box (demo failure)', () => {
  test('demo: intentionally expects the wrong echoed name', async ({ page }) => {
    const steps = new TextBoxSteps(page);
    const fields = { name: 'Jane Smith' };

    await steps.openTextBoxPage();
    await steps.fillForm(fields);
    await steps.submitForm();
    await steps.verifyOutput({ name: 'Someone Else' });
  });
});
