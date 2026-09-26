// Opt-in only — same DEMO_FAILURE gate as demo-failure.spec.ts (playwright.config.ts's ui project
// testIgnore), never runs in CI or a normal `npm test`. Deterministically simulates the two flaky
// shapes the dashboard's "Currently quarantined" / "Proposed for quarantine" cards are meant to
// show, by failing only on the first attempt (test.info().retry === 0) — local `retries` is 1, so
// each genuinely comes out with outcome 'flaky', not 'unexpected'. Real assertions throughout
// (existing verify* steps), so playwright/expect-expect passes and nothing here is a self-report.
//
// Deliberately reuses TextBoxSteps/CheckBoxSteps rather than a new page object (CLAUDE.md rule 2).
import { test } from '../../src/ui/fixtures';
import { TextBoxSteps } from '../../src/ui/steps/text-box.steps';
import { CheckBoxSteps } from '../../src/ui/steps/check-box.steps';
import { config } from '../../src/core/config';

test.describe('DemoQA UI @ Text Box (demo flaky — network)', () => {
  test('demo: flaky on a simulated connection reset', async ({ page }) => {
    if (test.info().retry === 0) {
      // A real net::ERR_CONNECTION_RESET — Playwright's route.abort('connectionreset') produces
      // the exact same error string a genuine transport failure does, not a stand-in message.
      await page.route(`${config.textBoxHost}**`, (route) => route.abort('connectionreset'));
    }

    const steps = new TextBoxSteps(page);
    const fields = { name: 'Jane Smith' };

    await steps.openTextBoxPage();
    await steps.fillForm(fields);
    await steps.submitForm();
    await steps.verifyOutput(fields);
  });
});

test.describe('DemoQA UI @ Check Box (demo flaky — assertion)', () => {
  test('demo: flaky on a one-off selection assertion miss', async ({ page }) => {
    const steps = new CheckBoxSteps(page);

    await steps.openCheckBoxPage();
    await steps.expandTree();
    await steps.toggle('Desktop');

    if (test.info().retry === 0) {
      // A real expect(locator).toBeVisible() failure — 'workspace' is NOT part of the
      // ['desktop', 'notes', 'commands'] selection toggling 'Desktop' actually produces, so this
      // genuinely times out waiting for it, not a hardcoded false condition standing in for one.
      await steps.verifySelected(['workspace']);
    } else {
      await steps.verifySelected(['desktop', 'notes', 'commands']);
    }
  });
});
