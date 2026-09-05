import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

// See docs/page-knowledge/book-store-list.md — the detail-view field panel shown for every book.
const DETAIL_FIELD_WRAPPERS = [
  'ISBN-wrapper',
  'title-wrapper',
  'subtitle-wrapper',
  'author-wrapper',
  'publisher-wrapper',
  'pages-wrapper',
  'description-wrapper',
  'website-wrapper',
] as const;

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

  async rowTitles(): Promise<string[]> {
    await this.rows.first().waitFor();
    return this.rows.locator('.action-buttons a').allInnerTexts();
  }

  detailFieldWrapper(field: (typeof DETAIL_FIELD_WRAPPERS)[number]): Locator {
    return this.page.locator(`#${field}`);
  }

  get detailFields(): readonly (typeof DETAIL_FIELD_WRAPPERS)[number][] {
    return DETAIL_FIELD_WRAPPERS;
  }
}
