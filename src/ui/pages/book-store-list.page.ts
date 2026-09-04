import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class BookStoreListPage {
  readonly searchBox: Locator;
  readonly rows: Locator;
  // See docs/page-knowledge/book-store-list.md — the value's own id is a leftover template
  // artifact (`userName-value`), scoped inside #pages-wrapper to guard against reuse elsewhere.
  readonly pagesValue: Locator;

  constructor(private readonly page: HealPage) {
    this.searchBox = page.locator('#searchBox');
    this.rows = page.locator('tbody tr');
    this.pagesValue = page.locator('#pages-wrapper #userName-value');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(config.bookStoreListHost);
  }

  async search(query: string) {
    await this.searchBox.fill(query);
  }

  bookLink(title: string): Locator {
    return this.rows.locator('a', { hasText: title });
  }

  async openBook(title: string) {
    await this.bookLink(title).click();
  }
}
