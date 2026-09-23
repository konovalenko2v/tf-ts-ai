import { z } from 'zod';
import {
  AuthResponseSchema,
  BookingDatesSchema,
  BookingRequestSchema,
  BookingSchema,
  CreateBookingResponseSchema,
} from '../schemas/booking.schema';

// Response types are inferred from the Zod schemas in ../schemas — one source of truth, so a type
// can never claim a field the runtime contract doesn't check (or the reverse).
export type BookingDates = z.infer<typeof BookingDatesSchema>;
export type BookingResponse = z.infer<typeof BookingSchema>;
export type CreateBookingResponse = z.infer<typeof CreateBookingResponseSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// Request body shape: every field optional, deliberately — negative tests and PATCH bodies omit
// fields on purpose. Inferred from the STRICT request schema, not Partial<BookingResponse>: the
// response type's index signature would let a misspelled field compile (see booking.schema.ts).
export type Booking = z.infer<typeof BookingRequestSchema>;

export interface AuthRequest {
  username: string;
  password: string;
}
