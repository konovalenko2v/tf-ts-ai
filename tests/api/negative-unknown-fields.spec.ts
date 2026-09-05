import { test, expect } from '@playwright/test';
import { config } from '../../src/core/config';
import { validBooking } from '../../src/api/data/booking.data';
import { BookingClient } from '../../src/api/clients/booking.client';
import { getAuthToken } from '../../src/api/auth/token.provider';

test.describe('Restful Booker API @ Negative & edge cases', () => {
  // Cleanup lives in afterEach, not a try/finally in the test body — see negative-empty-names.spec.ts.
  let bookingId: number | undefined;

  test.afterEach(async ({ request }) => {
    if (!bookingId) return;
    const bookingClient = new BookingClient(request);
    const token = await getAuthToken(request);
    const deleteResponse = await bookingClient.deleteBooking(bookingId, token);
    expect(deleteResponse.status()).toBe(201);
    bookingId = undefined;
  });

  test('POST /booking with extra unrecognized fields: API ignores unknown fields and creates the booking successfully (documenting current behavior)', async ({
    request,
  }) => {
    const baseBooking = validBooking();
    const rawBody = {
      ...baseBooking,
      unsupportedExtraField: 'ignored-value',
      nestedExtraField: { key: 'value' },
    };

    const response = await request.post(`${config.host}/booking`, { data: rawBody });
    expect(response.status()).toBe(200);

    const body = await response.json();
    bookingId = body.bookingid;
    expect(body.bookingid).toBeGreaterThan(0);
    expect(body.booking.firstname).toBe(baseBooking.firstname);
    expect(body.booking.lastname).toBe(baseBooking.lastname);

    // The API ignores unknown fields and does not include them in the returned booking object
    expect(body.booking.unsupportedExtraField).toBeUndefined();
    expect(body.booking.nestedExtraField).toBeUndefined();
  });
});
