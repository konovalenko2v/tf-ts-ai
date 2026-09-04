import { APIRequestContext, test } from '@playwright/test';
import { BookStoreClient } from '../clients/book-store.client';
import { Book } from '../types/book-store';

export class BookStoreSteps {
  private readonly bookStoreClient: BookStoreClient;

  constructor(request: APIRequestContext) {
    this.bookStoreClient = new BookStoreClient(request);
  }

  async getAllBooks(): Promise<Book[]> {
    return test.step('Get all books', async () => {
      const response = await this.bookStoreClient.getBooks();
      if (response.status() !== 200) {
        throw new Error(`getBooks failed with status ${response.status()}`);
      }
      const body = await response.json();
      return body.books;
    });
  }
}
