import { z } from 'zod';

// Response contracts for Restful Booker, built from captured live payloads rather than from the
// request-side `Booking` type (which is all-optional so negative/PATCH bodies can omit any field —
// an all-optional response schema would accept `{}` and check nothing).
//
// z.looseObject, never z.object: plain z.object STRIPS unknown keys from the parsed result. That
// would turn negative-unknown-fields.spec.ts's `expect(body.booking.unsupportedExtraField)
// .toBeUndefined()` into a tautology that passes whatever the API echoes back. looseObject
// validates the declared fields and passes everything else through untouched — tolerant of an
// additive API change, without hiding what the API actually returned.

// Field shapes shared by the response contract (loose) and the request type (strict) below, so the
// two can't drift apart in naming.
const bookingDatesShape = {
  checkin: z.string(),
  checkout: z.string(),
};

const bookingShape = {
  firstname: z.string(),
  lastname: z.string(),
  totalprice: z.number(),
  depositpaid: z.boolean(),
  // Omitted from the response entirely (not null) when the booking was created without it.
  additionalneeds: z.string().optional(),
};

export const BookingDatesSchema = z.looseObject(bookingDatesShape);

export const BookingSchema = z.looseObject({ ...bookingShape, bookingdates: BookingDatesSchema }).describe('Booking');

// Request-body type only (never used to parse): a plain z.object, all fields optional. NOT derived
// from the loose response schema — looseObject's inferred type carries a `[k: string]: unknown`
// index signature, which switches off TypeScript's excess-property check, so a typo such as
// `{ fristname: 'x' }` in a data factory would compile. The strict shape keeps that check.
export const BookingRequestSchema = z.object({ ...bookingShape, bookingdates: z.object(bookingDatesShape) }).partial();

export const CreateBookingResponseSchema = z
  .looseObject({
    bookingid: z.number().int().positive(),
    booking: BookingSchema,
  })
  .describe('CreateBookingResponse');

// For the "API accepts an invalid type" documentation tests only: a string `totalprice` comes back
// as `totalprice: null` (verified live), so the full CreateBookingResponse contract would reject
// it. Those tests assert acceptance and need nothing but the id for cleanup.
export const CreatedBookingIdSchema = z
  .looseObject({
    bookingid: z.number().int().positive(),
  })
  .describe('CreatedBookingId');

export const BookingIdListSchema = z.array(z.looseObject({ bookingid: z.number().int().positive() })).describe('BookingIdList');

// POST /auth answers 200 on both success and bad credentials — the difference is only which key
// is present. Modelled as one object with a refinement rather than a union, so the inferred type
// stays `{ token?: string; reason?: string }` and callers can read `body.token` without narrowing.
export const AuthResponseSchema = z
  .looseObject({
    token: z.string().min(1).optional(),
    reason: z.string().optional(),
  })
  .refine((body) => body.token !== undefined || body.reason !== undefined, {
    message: 'expected either `token` (success) or `reason` (rejected credentials)',
  })
  .describe('AuthResponse');
