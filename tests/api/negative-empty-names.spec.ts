import { test, expect } from '@playwright/test';
import { config } from '../../src/core/config';
import { bookingWithNames } from '../../src/api/data/booking.data';
import { BookingClient } from '../../src/api/clients/booking.client';
import { getAuthToken } from '../../src/api/auth/token.provider';

test.describe('Restful Booker API @ Negative & edge cases', () => {
  // Cleanup lives in afterEach, not a try/finally in the test body, so a booking created before an
  // unrelated throw (a helper error, not just a failed expect) still gets deleted — afterEach runs
  // regardless of how the test body exited.
  let bookingId: number | undefined;

  test.afterEach(async ({ request }) => {
    if (!bookingId) return;
    const bookingClient = new BookingClient(request);
    const token = await getAuthToken(request);
    const deleteResponse = await bookingClient.deleteBooking(bookingId, token);
    expect(deleteResponse.status()).toBe(201);
    bookingId = undefined;
  });

  test('POST /booking with empty strings for firstname and lastname: API accepts empty values without validation (documenting current behavior)', async ({
    request,
  }) => {
    const booking = bookingWithNames('', '');
    const response = await request.post(`${config.host}/booking`, { data: booking });

    expect(response.status()).toBe(200);
    const body = await response.json();
    bookingId = body.bookingid;
    expect(body.bookingid).toBeGreaterThan(0);
    expect(body.booking.firstname).toBe('');
    expect(body.booking.lastname).toBe('');
  });
});
