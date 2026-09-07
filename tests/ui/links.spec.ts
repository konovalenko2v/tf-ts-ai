import { test } from '../../src/ui/fixtures';
import { LinksSteps } from '../../src/ui/steps/links.steps';

test.describe('DemoQA UI @ Links', () => {
  test('Clicking "Moved" reports a 301 Moved Permanently response', async ({ page }) => {
    const steps = new LinksSteps(page);

    await steps.openLinksPage();
    await steps.clickMovedLink();
    await steps.verifyMovedResponse();
  });
});
