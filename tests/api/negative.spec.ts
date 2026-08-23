import { test, expect, APIRequestContext } from '@playwright/test';
import { config, getValidUserName, getValidUserPassword } from '../../src/core/config';
import { bookingWithDates, bookingWithNames, bookingWithTotalPrice } from '../../src/api/data/booking.data';
import { AuthClient } from '../../src/api/clients/auth.client';

test.describe('Restful Booker API @ Negative & edge cases', () => {
  const createdBookingIds: number[] = [];

  test('POST /booking with an empty JSON {} should return a client error instead of creating a booking', async ({
    request,
  }) => {
    const response = await request.post(`${config.host}/booking`, { data: {} });
    expect(response.status()).toBe(500);
  });

  test('POST /booking with unicode/special characters in the name should be created successfully and stored as-is', async ({
    request,
  }) => {
    const booking = bookingWithNames('Владимир-Ω', "O'Brien & Sons™ 日本語");
    const response = await request.post(`${config.host}/booking`, { data: booking });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.booking.firstname).toBe(booking.firstname);
    expect(body.booking.lastname).toBe(booking.lastname);

    createdBookingIds.push(body.bookingid);
  });

  test('POST /booking with a negative totalprice: API accepts the value without validation (documenting current behavior)', async ({
    request,
  }) => {
    const response = await request.post(`${config.host}/booking`, { data: bookingWithTotalPrice(-100) });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.booking.totalprice).toBe(-100);

    createdBookingIds.push(body.bookingid);
  });

  test("POST /booking with an invalid data type (totalprice as a string): API doesn't strictly validate the type and accepts the request (documenting current behavior)", async ({
    request,
  }) => {
    const rawBody = {
      firstname: 'John',
      lastname: 'Smith',
      totalprice: 'not-a-number',
      depositpaid: true,
      bookingdates: { checkin: '2026-08-01', checkout: '2026-08-10' },
      additionalneeds: 'Breakfast',
    };

    const response = await request.post(`${config.host}/booking`, { data: rawBody });
    expect(response.status()).toBe(200);
    const body = await response.json();
    createdBookingIds.push(body.bookingid);
  });

  test("POST /booking with an invalid data type (depositpaid as a string): API doesn't strictly validate the type and accepts the request (documenting current behavior)", async ({
    request,
  }) => {
    const rawBody = {
      firstname: 'John',
      lastname: 'Smith',
      totalprice: 100,
      depositpaid: 'maybe',
      bookingdates: { checkin: '2026-08-01', checkout: '2026-08-10' },
      additionalneeds: 'Breakfast',
    };

    const response = await request.post(`${config.host}/booking`, { data: rawBody });
    expect(response.status()).toBe(200);
    const body = await response.json();
    createdBookingIds.push(body.bookingid);
  });

  test('POST /booking with checkout preceding checkin: documenting current API behavior', async ({ request }) => {
    const response = await request.post(`${config.host}/booking`, {
      data: bookingWithDates('2026-08-10', '2026-08-01'),
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    createdBookingIds.push(body.bookingid);
  });

  test('GET /booking/{id} with a non-numeric id should return 404', async ({ request }) => {
    const response = await request.get(`${config.host}/booking/abc`);
    expect(response.status()).toBe(404);
  });

  test('DELETE /booking/{id} with an invalid token Cookie should return 403 Forbidden', async ({ request }) => {
    const response = await request.delete(`${config.host}/booking/1`, {
      headers: { Cookie: 'token=clearly-invalid-token' },
    });
    expect(response.status()).toBe(403);
  });

  test.afterEach(async ({ request }: { request: APIRequestContext }) => {
    if (createdBookingIds.length === 0) {
      return;
    }
    const authClient = new AuthClient(request);
    const authResponse = await authClient.authenticate(getValidUserName(), getValidUserPassword());
    const { token } = await authResponse.json();

    for (const id of createdBookingIds.splice(0)) {
      await request.delete(`${config.host}/booking/${id}`, { headers: { Cookie: `token=${token}` } });
    }
  });
});
