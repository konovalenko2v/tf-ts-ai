import { test, expect } from '@playwright/test';
import { config, getValidUserName, getValidUserPassword } from '../../src/core/config';
import { bookingWithNames } from '../../src/api/data/booking.data';
import { AuthClient } from '../../src/api/clients/auth.client';

test.describe('Restful Booker API @ Negative Generated', () => {
  test('POST /booking with empty strings for firstname and lastname: API accepts empty values without validation (documenting current behavior)', async ({
    request,
  }) => {
    const booking = bookingWithNames('', '');
    const response = await request.post(`${config.host}/booking`, { data: booking });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.bookingid).toBeGreaterThan(0);
    expect(body.booking.firstname).toBe('');
    expect(body.booking.lastname).toBe('');

    // Self-contained cleanup
    const bookingId = body.bookingid;
    const authClient = new AuthClient(request);
    const authResponse = await authClient.authenticate(getValidUserName(), getValidUserPassword());
    expect(authResponse.status()).toBe(200);
    const { token } = await authResponse.json();

    const deleteResponse = await request.delete(`${config.host}/booking/${bookingId}`, {
      headers: { Cookie: `token=${token}` },
    });
    expect(deleteResponse.status()).toBe(201);
  });
});
