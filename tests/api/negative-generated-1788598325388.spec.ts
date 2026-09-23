import { test, expect, APIRequestContext } from '@playwright/test';
import { config } from '../../src/core/config';
import { validBooking } from '../../src/api/data/booking.data';
import { getAuthToken } from '../../src/api/auth/token.provider';
import { parseBody } from '../../src/api/contract';
import { CreateBookingResponseSchema } from '../../src/api/schemas/booking.schema';

test.describe('Restful Booker API @ Negative & edge cases (generated)', () => {
  const createdBookingIds: number[] = [];

  test('POST /booking with a very long additionalneeds string (5000 chars): documenting current API behavior', async ({ request }) => {
    const longNeeds = 'A'.repeat(5000);
    const booking = { ...validBooking(), additionalneeds: longNeeds };

    const response = await request.post(`${config.host}/booking`, { data: booking });
    expect(response.status()).toBe(200);

    const body = await parseBody(response, CreateBookingResponseSchema);
    expect(body.booking.additionalneeds).toBe(longNeeds);

    createdBookingIds.push(body.bookingid);
  });

  test.afterEach(async ({ request }: { request: APIRequestContext }) => {
    if (createdBookingIds.length === 0) {
      return;
    }
    const token = await getAuthToken(request);

    for (const id of createdBookingIds.splice(0)) {
      await request.delete(`${config.host}/booking/${id}`, { headers: { Cookie: `token=${token}` } });
    }
  });
});
