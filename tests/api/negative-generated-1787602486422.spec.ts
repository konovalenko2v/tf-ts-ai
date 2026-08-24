import { test, expect } from '@playwright/test';
import { config, getValidUserName, getValidUserPassword } from '../../src/core/config';
import { validBooking } from '../../src/api/data/booking.data';
import { AuthClient } from '../../src/api/clients/auth.client';

test.describe('Restful Booker API @ Negative Generated', () => {
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
    expect(body.bookingid).toBeGreaterThan(0);
    expect(body.booking.firstname).toBe(baseBooking.firstname);
    expect(body.booking.lastname).toBe(baseBooking.lastname);

    // The API ignores unknown fields and does not include them in the returned booking object
    expect(body.booking.unsupportedExtraField).toBeUndefined();
    expect(body.booking.nestedExtraField).toBeUndefined();

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
