import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { BookingSteps } from '../../src/api/steps/booking.steps';
import { BookingClient } from '../../src/api/clients/booking.client';
import * as bookingData from '../../src/api/data/booking.data';
import { getAuthToken } from '../../src/api/auth/token.provider';
import { CreateBookingResponse } from '../../src/api/types/booking';

test.describe('Restful Booker API @ Booking CRUD', () => {
  let fixtureContext: APIRequestContext;
  let fixtureClient: BookingClient;
  let bookingSteps: BookingSteps;
  let bookingPrec: CreateBookingResponse;
  const bookingIds = new Set<number>();

  test.beforeAll(async () => {
    fixtureContext = await playwrightRequest.newContext();
    fixtureClient = new BookingClient(fixtureContext);
    const response = await fixtureClient.createBooking(bookingData.validBooking());
    bookingIds.add(response.bookingid);
    bookingPrec = response;
  });

  test.beforeEach(async ({ request }) => {
    bookingSteps = new BookingSteps(request);
  });

  async function createTrackedBooking(booking: ReturnType<typeof bookingData.validBooking>) {
    const response = await bookingSteps.createBooking(booking);
    bookingIds.add(response.bookingid);
    return response;
  }

  test('POST /booking creates a booking, response contains bookingid and the submitted data', async () => {
    const requestBody = bookingData.validBooking();
    const response = await createTrackedBooking(requestBody);

    expect(response.bookingid).toBeGreaterThan(0);
    expect(response.booking.firstname).toBe(requestBody.firstname);
    expect(response.booking.lastname).toBe(requestBody.lastname);
    expect(response.booking.totalprice).toBe(requestBody.totalprice);
    expect(response.booking.depositpaid).toBe(requestBody.depositpaid);
    expect(response.booking.additionalneeds).toBe(requestBody.additionalneeds);
  });

  test('GET /booking/{id} returns the previously created booking', async () => {
    const response = await bookingSteps.getBookingById(bookingPrec.bookingid);
    expect(response.status()).toBe(200);
    const booking = await response.json();

    expect(booking.firstname).toBeTruthy();
    expect(booking.lastname).toBeTruthy();
  });

  test('GET /booking/{id} with a non-existent id should return 404 Not Found', async () => {
    const response = await bookingSteps.getBookingById(999999999);
    expect(response.status()).toBe(404);
  });

  test('GET /booking returns a non-empty list of booking ids', async () => {
    const bookings = await bookingSteps.getAllBookingIds();
    expect(bookings.length).toBeGreaterThan(0);
  });

  test('GET /booking?firstname=...&lastname=... returns bookings including the one just created', async () => {
    const ids = await bookingSteps.getBookingIdsFilteredByName(
      bookingPrec.booking.firstname!,
      bookingPrec.booking.lastname!,
    );
    expect(ids).toContain(bookingPrec.bookingid);
  });

  test('GET /booking?checkin=...&checkout=... returns a list without errors', async () => {
    const response = await bookingSteps.getBookingsFilteredByDates('2026-08-01', '2026-08-10');
    expect(response.status()).toBe(200);
  });

  test('PUT /booking/{id} with a valid token in the Cookie updates all fields', async ({ request }) => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const updated = {
      ...bookingData.validBooking(),
      firstname: 'Jane',
      lastname: 'Doe',
      totalprice: 500,
      depositpaid: false,
      bookingdates: { checkin: '2026-09-01', checkout: '2026-09-05' },
      additionalneeds: 'Late checkout',
    };

    const token = await getAuthToken(request);
    const response = await bookingSteps.updateBooking(created.bookingid, updated, token);
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.firstname).toBe('Jane');
    expect(body.lastname).toBe('Doe');
    expect(body.totalprice).toBe(500);
  });

  test('PUT /booking/{id} without the token Cookie should return 403 Forbidden', async () => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const response = await bookingSteps.updateBooking(created.bookingid, bookingData.validBooking(), null);
    expect(response.status()).toBe(403);
  });

  test('PUT /booking/{id} with an invalid token Cookie value should return 403 Forbidden', async () => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const response = await bookingSteps.updateBooking(
      created.bookingid,
      bookingData.validBooking(),
      'invalid-token-value',
    );
    expect(response.status()).toBe(403);
  });

  test('PATCH /booking/{id} updates only the submitted fields, the rest stay unchanged', async ({ request }) => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const patchBody = bookingData.bookingWithNames('Robert', 'Martin');

    const token = await getAuthToken(request);
    const response = await bookingSteps.partialUpdateBooking(created.bookingid, patchBody, token);
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.firstname).toBe('Robert');
    expect(body.lastname).toBe('Martin');
  });

  test('PATCH /booking/{id} updates with invalid token', async () => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const patchBody = bookingData.bookingWithNames('Robert', 'Martin');

    const response = await bookingSteps.partialUpdateBooking(created.bookingid, patchBody, 'invalidTOken');
    expect(response.status()).toBe(403);
  });

  test('PATCH /booking/{id} updates without token', async () => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const patchBody = { firstname: 'John', lastname: 'Smith' };

    const response = await bookingSteps.partialUpdateBooking(created.bookingid, patchBody, null);
    expect(response.status()).toBe(403);
  });

  test('DELETE /booking/{id} without the token Cookie should return 403 Forbidden, booking remains', async () => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const response = await bookingSteps.deleteBooking(created.bookingid, null);
    expect(response.status()).toBe(403);
  });

  test('DELETE /booking/{id} with a valid token Cookie deletes the booking, status 201', async ({ request }) => {
    const created = await createTrackedBooking(bookingData.validBooking());
    const token = await getAuthToken(request);

    const deleteResponse = await bookingSteps.deleteBooking(created.bookingid, token);
    expect(deleteResponse.status()).toBe(201);

    const getResponse = await bookingSteps.getBookingById(created.bookingid);
    expect(getResponse.status()).toBe(404);
  });

  test.afterAll(async () => {
    const token = await getAuthToken(fixtureContext);
    for (const id of bookingIds) {
      await fixtureClient.deleteBooking(id, token);
    }
    await fixtureContext.dispose();
  });
});
