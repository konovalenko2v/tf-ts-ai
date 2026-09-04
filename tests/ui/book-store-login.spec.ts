import { test } from '../../src/ui/fixtures';
import { BookStoreLoginSteps } from '../../src/ui/steps/book-store-login.steps';
import { getBookStoreUserName, getBookStorePassword } from '../../src/core/config';

test.describe('DemoQA UI @ Book Store Login', () => {
  test('Logged-in user sees "Speaking JavaScript" in their collection', async ({ page }) => {
    const steps = new BookStoreLoginSteps(page);
    const userName = getBookStoreUserName();
    const password = getBookStorePassword();

    await steps.openLoginPage();
    await steps.loginAs(userName, password);
    await steps.verifyLoggedInAs(userName);
    await steps.verifyBookInCollection('Speaking JavaScript');
  });
});
