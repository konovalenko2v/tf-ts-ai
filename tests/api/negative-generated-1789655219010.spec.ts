import { test, expect } from '@playwright/test';
import { config, getValidUserName, getValidUserPassword } from '../../src/core/config';
import { validBooking } from '../../src/api/data/booking.data';
import { AuthClient } from '../../src/api/clients/auth.client';
import { BookingClient } from '../../src/api/clients/booking.client';

test.describe('@api Restful Booker API @ Negative & edge cases (generated)', () => {
  let createdBookingId: number;

  test.beforeEach(async ({ request }) => {
    const bookingClient = new BookingClient(request);
    const created = await bookingClient.createBooking(validBooking());
    createdBookingId = created.bookingid;
  });

  test('PUT /booking/{id} without an auth token Cookie should return 403 Forbidden', async ({ request }) => {
    const bookingClient = new BookingClient(request);
    const response = await bookingClient.updateBooking(createdBookingId, validBooking(), null);

    expect(response.status()).toBe(403);
  });

  test.afterEach(async ({ request }) => {
    const authClient = new AuthClient(request);
    const authResponse = await authClient.authenticate(getValidUserName(), getValidUserPassword());
    const { token } = await authResponse.json();

    await request.delete(`${config.host}/booking/${createdBookingId}`, { headers: { Cookie: `token=${token}` } });
  });
});
