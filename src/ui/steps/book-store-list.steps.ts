import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { BookStoreListPage } from '../pages/book-store-list.page';

export class BookStoreListSteps {
  readonly bookStoreListPage: BookStoreListPage;

  constructor(page: HealPage) {
    this.bookStoreListPage = new BookStoreListPage(page);
  }

  async openBookStorePage() {
    await test.step('Open the Book Store list page', async () => this.bookStoreListPage.navigate());
  }

  async searchFor(title: string) {
    await test.step(`Search for "${title}"`, async () => this.bookStoreListPage.search(title));
  }

  async openBook(title: string) {
    await test.step(`Open the book "${title}"`, async () => this.bookStoreListPage.openBook(title));
  }

  async verifyTotalPages(expectedPages: number) {
    await test.step(`Verify Total Pages is ${expectedPages}`, async () => {
      await expect(this.bookStoreListPage.pagesValue).toHaveText(String(expectedPages));
    });
  }
}
