import { test } from '../../src/ui/fixtures';
import { BookStoreLoginSteps } from '../../src/ui/steps/book-store-login.steps';
import { getBookStoreUserName, getBookStorePassword } from '../../src/core/config';

test.describe('DemoQA UI @ Book Store Login', () => {
  // Both assertions share a single login (rather than each test logging in separately) because
  // DemoQA's login endpoint rejects a second rapid login for the same account with "Invalid
  // username or password!" within one test run — confirmed live, not a credentials issue (the
  // API's GenerateToken kept succeeding throughout).
  test('Logged-in user has 2 books in their collection, including "You Don\'t Know JS"', async ({ page }) => {
    const steps = new BookStoreLoginSteps(page);
    const userName = getBookStoreUserName();
    const password = getBookStorePassword();

    await steps.openLoginPage();
    await steps.loginAs(userName, password);
    await steps.verifyLoggedInAs(userName);
    await steps.verifyBookInCollection('Speaking JavaScript');
    await steps.verifyBookInCollection("You Don't Know JS");
    await steps.verifyCollectionSize(2);
  });
});
