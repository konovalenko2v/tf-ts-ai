import { test } from '../../src/ui/fixtures';
import { BookStoreListSteps } from '../../src/ui/steps/book-store-list.steps';

test.describe('DemoQA UI @ Book Store', () => {
  test('Opens "You Don\'t Know JS" and verifies it has 278 pages', async ({ page }) => {
    const steps = new BookStoreListSteps(page);
    const title = "You Don't Know JS";

    await steps.openBookStorePage();
    await steps.searchFor(title);
    await steps.openBook(title);
    await steps.verifyTotalPages(278);
  });
});
