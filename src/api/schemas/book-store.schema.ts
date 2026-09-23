import { z } from 'zod';

// Response contract for DemoQA's Book Store API, built from a captured live GET /BookStore/v1/Books
// payload. looseObject for the same reason as booking.schema.ts: validate declared fields without
// stripping anything else from the parsed result.

export const BookSchema = z
  .looseObject({
    isbn: z.string().min(1),
    title: z.string(),
    subTitle: z.string(),
    author: z.string(),
    publish_date: z.string(),
    publisher: z.string(),
    pages: z.number().int(),
    description: z.string(),
    website: z.string(),
  })
  .describe('Book');

export const BooksResponseSchema = z
  .looseObject({
    books: z.array(BookSchema),
  })
  .describe('BooksResponse');
