// Unit coverage for src/api/contract.ts and the response schemas in src/api/schemas/ — no network:
// parseBody only needs json()/url()/status() from an APIResponse, so a minimal stand-in is enough.
import { test, expect, APIResponse } from '@playwright/test';
import { parseBody, ContractViolationError, CONTRACT_VIOLATION_PREFIX } from '../../src/api/contract';
import {
  AuthResponseSchema,
  BookingIdListSchema,
  BookingSchema,
  CreateBookingResponseSchema,
  CreatedBookingIdSchema,
} from '../../src/api/schemas/booking.schema';
import { BooksResponseSchema } from '../../src/api/schemas/book-store.schema';

function fakeResponse(body: unknown, status = 200, url = 'https://host/booking/42'): APIResponse {
  return { json: () => Promise.resolve(body), url: () => url, status: () => status } as unknown as APIResponse;
}

// Captured from the live API — the payload the schema is supposed to accept.
const liveBooking = {
  firstname: 'Zod',
  lastname: 'Probe',
  totalprice: 111,
  depositpaid: true,
  bookingdates: { checkin: '2026-08-01', checkout: '2026-08-10' },
  additionalneeds: 'x',
};

test.describe('parseBody', () => {
  test('returns the typed body when it matches the schema', async () => {
    const body = await parseBody(fakeResponse({ bookingid: 4700, booking: liveBooking }), CreateBookingResponseSchema);
    expect(body.bookingid).toBe(4700);
    expect(body.booking.totalprice).toBe(111);
  });

  test('throws a ContractViolationError naming the URL, status, schema and the offending field', async () => {
    const drifted = { bookingid: 4700, booking: { ...liveBooking, totalprice: '111' } };
    const error = await parseBody(fakeResponse(drifted), CreateBookingResponseSchema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContractViolationError);
    const message = (error as Error).message;
    expect(message.startsWith(CONTRACT_VIOLATION_PREFIX)).toBe(true);
    expect(message).toContain('https://host/booking/42');
    expect(message).toContain('HTTP 200');
    expect(message).toContain('CreateBookingResponse');
    expect(message).toContain('totalprice');
  });

  test('rejects a missing required field — the response schema must not be all-optional', async () => {
    const { firstname: _dropped, ...withoutFirstname } = liveBooking;
    await expect(parseBody(fakeResponse(withoutFirstname), BookingSchema)).rejects.toThrow(ContractViolationError);
  });
});

test.describe('response schemas', () => {
  // The trap this guards: plain z.object strips unknown keys, which would make
  // negative-unknown-fields.spec.ts's "API drops unknown fields" assertion pass no matter what the
  // API returned. If this test fails, someone switched a schema to z.object.
  test('pass unknown fields through instead of stripping them', () => {
    const parsed = CreateBookingResponseSchema.parse({
      bookingid: 1,
      booking: { ...liveBooking, unsupportedExtraField: 'echoed' },
      topLevelExtra: true,
    });
    expect(parsed.booking.unsupportedExtraField).toBe('echoed');
    expect(parsed.topLevelExtra).toBe(true);
  });

  test('additionalneeds is optional — the API omits it when a booking was created without it', () => {
    const { additionalneeds: _omitted, ...withoutNeeds } = liveBooking;
    expect(BookingSchema.safeParse(withoutNeeds).success).toBe(true);
  });

  test('the full contract rejects the null totalprice the API returns for a string input, the id-only one accepts it', () => {
    const coerced = { bookingid: 7, booking: { ...liveBooking, totalprice: null } };
    expect(CreateBookingResponseSchema.safeParse(coerced).success).toBe(false);
    expect(CreatedBookingIdSchema.safeParse(coerced).success).toBe(true);
  });

  test('AuthResponse accepts a token or a reason, but not neither', () => {
    expect(AuthResponseSchema.safeParse({ token: 'abc123' }).success).toBe(true);
    expect(AuthResponseSchema.safeParse({ reason: 'Bad credentials' }).success).toBe(true);
    expect(AuthResponseSchema.safeParse({}).success).toBe(false);
    expect(AuthResponseSchema.safeParse({ token: '' }).success).toBe(false);
  });

  test('BookingIdList rejects a non-numeric id', () => {
    expect(BookingIdListSchema.safeParse([{ bookingid: 1 }, { bookingid: 2 }]).success).toBe(true);
    expect(BookingIdListSchema.safeParse([{ bookingid: '1' }]).success).toBe(false);
  });

  test('BooksResponse requires the books array', () => {
    expect(BooksResponseSchema.safeParse({ books: [] }).success).toBe(true);
    expect(BooksResponseSchema.safeParse({}).success).toBe(false);
  });
});
