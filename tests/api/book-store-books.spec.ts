import { test, expect } from '@playwright/test';
import { BookStoreSteps } from '../../src/api/steps/book-store.steps';

test.describe('DemoQA Book Store API @ Books', () => {
  test('GET /BookStore/v1/Books includes a book with 278 pages', async ({ request }) => {
    const bookStoreSteps = new BookStoreSteps(request);
    const books = await bookStoreSteps.getAllBooks();

    const book = books.find((b) => b.pages === 278);

    expect(book).toBeDefined();
    expect(book?.isbn).toBe('9781491904244');
    expect(book?.title).toBe("You Don't Know JS");
  });
});
