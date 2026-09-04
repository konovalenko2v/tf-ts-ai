import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { BookStoreLoginPage } from '../pages/book-store-login.page';

export class BookStoreLoginSteps {
  readonly loginPage: BookStoreLoginPage;

  constructor(page: HealPage) {
    this.loginPage = new BookStoreLoginPage(page);
  }

  async openLoginPage() {
    await test.step('Open the Book Store login page', async () => this.loginPage.navigate());
  }

  async loginAs(userName: string, password: string) {
    await test.step(`Log in as "${userName}"`, async () => this.loginPage.login(userName, password));
  }

  async verifyLoggedInAs(userName: string) {
    await test.step(`Verify logged in as "${userName}"`, async () => {
      await expect(this.loginPage.loggedInUserName).toHaveText(userName);
    });
  }

  async verifyBookInCollection(title: string) {
    await test.step(`Verify "${title}" is in the user's collection`, async () => {
      await expect(this.loginPage.bookRow(title)).toBeVisible();
    });
  }

  async verifyCollectionSize(expectedCount: number) {
    await test.step(`Verify the collection has ${expectedCount} book(s)`, async () => {
      await expect(this.loginPage.profileRows).toHaveCount(expectedCount);
    });
  }
}
