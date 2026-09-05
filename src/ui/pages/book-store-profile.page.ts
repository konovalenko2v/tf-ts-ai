import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { BookStoreLoginPage } from './book-store-login.page';

export class BookStoreProfilePage {
  readonly loginPage: BookStoreLoginPage;
  readonly profileRows: Locator;

  constructor(private readonly page: HealPage) {
    this.loginPage = new BookStoreLoginPage(page);
    this.profileRows = this.loginPage.profileRows;
  }

  async navigate() {
    await this.loginPage.navigate();
  }

  async login(userName: string, password: string) {
    await this.loginPage.login(userName, password);
  }

  // Per docs/page-knowledge/book-store-login.md: clicking #delete-record-<ISBN> opens a React
  // confirm modal rather than deleting immediately, and its OK button (#closeSmallModal-ok) must
  // be targeted by id — getByRole('button', { name: 'OK' }) resolves to 3 elements on this page.
  async deleteBook(isbn: string) {
    await this.page.locator(`#delete-record-${isbn}`).click();
    await this.page.locator('#closeSmallModal-ok').click();
  }
}

export async function achieve(page: HealPage, userName: string, password: string): Promise<void> {
  const profilePage = new BookStoreProfilePage(page);
  await profilePage.navigate();
  await profilePage.login(userName, password);
  await profilePage.profileRows.first().waitFor();

  let rowCount = await profilePage.profileRows.count();
  while (rowCount > 0) {
    const isbnHref = await profilePage.profileRows.first().locator('a[href*="/books?search="]').getAttribute('href');
    if (!isbnHref) {
      throw new Error('could not read an ISBN from the first remaining collection row to delete it');
    }
    const isbn = new URL(isbnHref, 'https://demoqa.com').searchParams.get('search');
    if (!isbn) {
      throw new Error(`could not extract ISBN from href "${isbnHref}"`);
    }

    await profilePage.deleteBook(isbn);
    const remaining = rowCount - 1;
    // Poll the row count without an assertion helper — this file must never author the success
    // check, see src/goal-evolution/goal.ts's header comment. Bounded, not indefinite: if the
    // count never drops (a stale locator, a delete that silently no-oped), this throws instead
    // of hanging.
    for (let i = 0; i < 20 && (await profilePage.profileRows.count()) !== remaining; i++) {
      await page.waitForTimeout(250);
    }
    rowCount = await profilePage.profileRows.count();
    if (rowCount !== remaining) {
      throw new Error(`expected ${remaining} row(s) after deleting ISBN ${isbn}, still see ${rowCount}`);
    }
  }
}
