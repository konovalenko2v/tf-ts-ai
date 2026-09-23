import { z } from 'zod';
import { AuthResponseSchema, BookingDatesSchema, BookingSchema, CreateBookingResponseSchema } from '../schemas/booking.schema';

// Response types are inferred from the Zod schemas in ../schemas — one source of truth, so a type
// can never claim a field the runtime contract doesn't check (or the reverse).
export type BookingDates = z.infer<typeof BookingDatesSchema>;
export type BookingResponse = z.infer<typeof BookingSchema>;
export type CreateBookingResponse = z.infer<typeof CreateBookingResponseSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// Request body shape: every field optional, deliberately — negative tests and PATCH bodies omit
// fields on purpose. Derived from the response contract so the two can't drift apart in naming.
// Plain Partial, not Omit-and-rebuild: the inferred looseObject type carries a string index
// signature, and Omit over an index-signature type collapses to the index signature alone,
// silently dropping every named field.
export type Booking = Partial<BookingResponse>;

export interface AuthRequest {
  username: string;
  password: string;
}
