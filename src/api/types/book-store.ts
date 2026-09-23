import { z } from 'zod';
import { BookSchema, BooksResponseSchema } from '../schemas/book-store.schema';

// Inferred from the Zod contract in ../schemas — see ../types/booking.ts.
export type Book = z.infer<typeof BookSchema>;
export type BooksResponse = z.infer<typeof BooksResponseSchema>;
