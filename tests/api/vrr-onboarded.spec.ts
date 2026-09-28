import { request as playwrightRequest, APIRequestContext, test, expect } from '@playwright/test';
import { VrrSteps } from '../../src/api-onboarder/generated/vrr/vrr.steps';
import { PropertyOut, ReservationOut } from '../../src/api-onboarder/generated/vrr/types';

function vrrCredentials() {
  const username = process.env.VRR_USERNAME;
  const password = process.env.VRR_PASSWORD;
  if (!username || !password) {
    throw new Error('VRR_USERNAME and VRR_PASSWORD must both be set to run the vrr-onboarded suite.');
  }
  return { username, password };
}

test.describe('VRR API @ Onboarded CRUD', () => {
  let context: APIRequestContext;
  let vrrSteps: VrrSteps;
  const reservationIds = new Set<number>();

  test.beforeEach(async () => {
    context = await playwrightRequest.newContext();
    vrrSteps = new VrrSteps(context);
    const loginResponse = await vrrSteps.login(vrrCredentials());
    expect(loginResponse.status()).toBe(200);
  });

  test.afterEach(async () => {
    for (const id of reservationIds) {
      await vrrSteps.cancelReservation(id);
    }
    reservationIds.clear();
    await context.dispose();
  });

  test('creates a reservation, reads it back, then cancels it', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    expect(propertiesResponse.status()).toBe(200);
    const properties: PropertyOut[] = await propertiesResponse.json();
    expect(properties.length).toBeGreaterThan(0);
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const createResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `QA Guest ${suffix}`,
      guest_email: `qa-guest-${suffix}@example.com`,
      check_in: '2027-01-10',
      check_out: '2027-01-12',
      adults: 2,
      children: 0,
    });
    expect(createResponse.status()).toBe(201);
    const created: ReservationOut = await createResponse.json();
    reservationIds.add(created.id);

    expect(created.property_id).toBe(property.id);
    expect(created.guest_name).toBe(`QA Guest ${suffix}`);
    expect(created.guest_email).toBe(`qa-guest-${suffix}@example.com`);
    expect(created.adults).toBe(2);
    expect(created.children).toBe(0);

    const getResponse = await vrrSteps.getReservationById(created.id);
    expect(getResponse.status()).toBe(200);
    const fetched: ReservationOut = await getResponse.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.guest_name).toBe(`QA Guest ${suffix}`);

    const cancelResponse = await vrrSteps.cancelReservation(created.id);
    expect(cancelResponse.status()).toBe(204);
    reservationIds.delete(created.id);

    const getAfterCancel = await vrrSteps.getReservationById(created.id);
    expect(getAfterCancel.status()).toBe(404);
  });

  test('GET /api/reservations/{id} with an implausibly large id returns 404 Not Found', async () => {
    const response = await vrrSteps.getReservationById(999999999);
    expect(response.status()).toBe(404);
  });

  test('GET /api/auth/me reflects the just-authenticated session', async () => {
    const meResponse = await vrrSteps.getMe();
    expect(meResponse.status()).toBe(200);
  });

  // Confirmed live in the UI first: booking Ocean View Cottage (sleeps 6) with 10 adults shows an
  // inline "Total guests (10) exceeds property capacity (6)" error and blocks submit. The API
  // enforces the same rule server-side (422, same message) — this locks that server-side behavior
  // in independently of whatever the UI's client-side check does.
  test('POST /api/reservations rejects a guest count over the property capacity', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties.find((p) => p.max_guests < 20);
    if (!property) throw new Error('No property with max_guests < 20 found — cannot construct an over-capacity request');

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Capacity Guest ${suffix}`,
      guest_email: `capacity-${suffix}@example.com`,
      check_in: '2027-02-10',
      check_out: '2027-02-12',
      adults: property.max_guests + 4,
      children: 0,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain(`exceeds property capacity (${property.max_guests})`);
    // A 422 means no reservation was created — nothing to add to reservationIds for cleanup.
  });

  // The onboarded persona's own hard rule forbids a "wrong credentials" negative test on login
  // itself (every other test depends on login succeeding) — this instead confirms the OTHER side
  // of the session lifecycle: a session that was valid stops being valid after logout, on the same
  // client that held it. That boundary is invisible from reading the spec alone (undeclared
  // `security`) and was only confirmed by driving the real login/logout flow.
  test('a protected endpoint 401s again after logout, on the same session', async () => {
    const meBeforeLogout = await vrrSteps.getMe();
    expect(meBeforeLogout.status()).toBe(200);

    const logoutResponse = await vrrSteps.logout();
    expect(logoutResponse.status()).toBe(200);

    const meAfterLogout = await vrrSteps.getMe();
    expect(meAfterLogout.status()).toBe(401);

    const propertiesAfterLogout = await vrrSteps.listProperties();
    expect(propertiesAfterLogout.status()).toBe(401);
  });

  test('total_price is nights × nightly_rate for the booked property', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const createResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Price Check Guest ${suffix}`,
      guest_email: `price-${suffix}@example.com`,
      check_in: '2027-03-01',
      check_out: '2027-03-04', // 3 nights
      adults: 2,
      children: 0,
    });
    expect(createResponse.status()).toBe(201);
    const created: ReservationOut = await createResponse.json();
    reservationIds.add(created.id);

    expect(created.nights).toBe(3);
    // Float multiplication (e.g. 3 * 385.0) can pick up binary floating-point noise — round to
    // cents before comparing rather than asserting exact equality on the raw float.
    expect(Math.round(created.total_price * 100)).toBe(Math.round(3 * property.nightly_rate * 100));
  });

  test('GET /api/reservations filters by property_id', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const createResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Filter Check Guest ${suffix}`,
      guest_email: `filter-${suffix}@example.com`,
      check_in: '2027-04-01',
      check_out: '2027-04-03',
      adults: 2,
      children: 0,
    });
    const created: ReservationOut = await createResponse.json();
    reservationIds.add(created.id);

    const filteredResponse = await vrrSteps.listReservations(String(property.id));
    expect(filteredResponse.status()).toBe(200);
    const filtered: ReservationOut[] = await filteredResponse.json();
    expect(filtered.some((r) => r.id === created.id)).toBe(true);
    for (const r of filtered) {
      expect(r.property_id).toBe(property.id);
    }
  });

  test('GET /api/reservations?status=upcoming returns only upcoming reservations', async () => {
    const response = await vrrSteps.listReservations(undefined, 'upcoming');
    expect(response.status()).toBe(200);
    const results: ReservationOut[] = await response.json();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.status).toBe('upcoming');
    }
  });

  test('POST /api/reservations rejects check_out equal to check_in', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Same-Day Guest ${suffix}`,
      guest_email: `same-day-${suffix}@example.com`,
      check_in: '2027-12-10',
      check_out: '2027-12-10',
      adults: 2,
      children: 0,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('check_out must be after check_in');
  });

  test('POST /api/reservations rejects check_out before check_in', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Backwards Dates Guest ${suffix}`,
      guest_email: `backwards-${suffix}@example.com`,
      check_in: '2027-12-15',
      check_out: '2027-12-10',
      adults: 2,
      children: 0,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('check_out must be after check_in');
  });

  // Real gap, confirmed live before writing this test: the API has no lower bound on check_in at
  // all — a reservation with check_in in 2020 is accepted with 201, not rejected. This asserts the
  // CURRENT (accepting) behavior on purpose, the same way the status-filter test above asserts the
  // current behavior of that bug: the app has no validation here, and a test that silently expected
  // a 4xx would just be wrong, not documenting anything. If a past-date guard is ever added, this
  // test starts failing and should be rewritten to assert the rejection instead.
  test('POST /api/reservations currently accepts a check_in date in the past — no lower-bound validation exists', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    // A fixed historical date risks colliding with seed data or a leftover reservation from an
    // earlier run on the same property (confirmed live: 2020-01-01 collided with existing seed
    // data on property #1 and produced a 409, not the 201 this test is actually about) — a random
    // year in the deep past keeps this test about the missing lower-bound check, not date luck.
    const pastYear = 1990 + Math.floor(Math.random() * 20);
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Past Date Guest ${suffix}`,
      guest_email: `past-date-${suffix}@example.com`,
      check_in: `${pastYear}-01-01`,
      check_out: `${pastYear}-01-05`,
      adults: 2,
      children: 0,
    });
    expect(response.status()).toBe(201);
    const created: ReservationOut = await response.json();
    reservationIds.add(created.id);
    expect(created.status).toBe('past');
  });

  test('POST /api/reservations rejects overlapping dates on the same property with a 409', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const firstResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Overlap Guest A ${suffix}`,
      guest_email: `overlap-a-${suffix}@example.com`,
      check_in: '2027-12-20',
      check_out: '2027-12-25',
      adults: 2,
      children: 0,
    });
    expect(firstResponse.status()).toBe(201);
    const first: ReservationOut = await firstResponse.json();
    reservationIds.add(first.id);

    // Overlaps the first booking's 20th-25th range by two nights (22nd-25th) — not identical
    // dates, so this also confirms the check is a real date-range overlap, not an exact-match
    // duplicate check.
    const secondResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Overlap Guest B ${suffix}`,
      guest_email: `overlap-b-${suffix}@example.com`,
      check_in: '2027-12-22',
      check_out: '2027-12-27',
      adults: 2,
      children: 0,
    });
    expect(secondResponse.status()).toBe(409);
    const body = await secondResponse.json();
    expect(JSON.stringify(body)).toContain(`reservation #${first.id}`);
  });

  test('POST /api/reservations allows a back-to-back booking that starts the day the previous one ends', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const firstResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Adjacent Guest A ${suffix}`,
      guest_email: `adjacent-a-${suffix}@example.com`,
      check_in: '2027-11-20',
      check_out: '2027-11-23',
      adults: 2,
      children: 0,
    });
    expect(firstResponse.status()).toBe(201);
    const first: ReservationOut = await firstResponse.json();
    reservationIds.add(first.id);

    // check_in here is exactly the first reservation's check_out — a real-world back-to-back
    // booking (one guest leaves the morning the next arrives), which must NOT be treated as an
    // overlap.
    const secondResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Adjacent Guest B ${suffix}`,
      guest_email: `adjacent-b-${suffix}@example.com`,
      check_in: '2027-11-23',
      check_out: '2027-11-26',
      adults: 2,
      children: 0,
    });
    expect(secondResponse.status()).toBe(201);
    const second: ReservationOut = await secondResponse.json();
    reservationIds.add(second.id);
  });

  test('GET /api/health reports the API as up', async () => {
    const response = await vrrSteps.getHealth();
    expect(response.status()).toBe(200);
  });

  // Every other test uses listProperties() only as setup (to pick a property id/rate/capacity) and
  // never asserts on the shape of a single property itself — this is the one place that does, so a
  // field rename or type change on PropertyOut is caught here instead of surfacing as a confusing
  // failure somewhere that merely consumes the list.
  test('GET /api/properties returns properties with the expected shape', async () => {
    const response = await vrrSteps.listProperties();
    expect(response.status()).toBe(200);
    const properties: PropertyOut[] = await response.json();
    expect(properties.length).toBeGreaterThan(0);

    for (const property of properties) {
      expect(typeof property.id).toBe('number');
      expect(typeof property.name).toBe('string');
      expect(typeof property.address).toBe('string');
      expect(typeof property.bedrooms).toBe('number');
      expect(typeof property.max_guests).toBe('number');
      expect(typeof property.nightly_rate).toBe('number');
    }
  });

  test('DELETE /api/reservations/{id} on a non-existent id returns 404 Not Found', async () => {
    const response = await vrrSteps.cancelReservation(999999999);
    expect(response.status()).toBe(404);
  });

  // The existing overlap test (above) only proves overlap detection works on the SAME property.
  // Booking the identical date range on a DIFFERENT property must succeed — overlap-checking is
  // scoped per-property, not global. A global check would incorrectly reject two unrelated
  // properties' reservations, which would itself be a real bug.
  test('POST /api/reservations allows the same date range on a different property', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    expect(properties.length).toBeGreaterThan(1);
    const [propertyA, propertyB] = properties;

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const firstResponse = await vrrSteps.createReservation({
      property_id: propertyA.id,
      guest_name: `Cross-Property Guest A ${suffix}`,
      guest_email: `cross-a-${suffix}@example.com`,
      check_in: '2027-08-05',
      check_out: '2027-08-08',
      adults: 2,
      children: 0,
    });
    expect(firstResponse.status()).toBe(201);
    const first: ReservationOut = await firstResponse.json();
    reservationIds.add(first.id);

    const secondResponse = await vrrSteps.createReservation({
      property_id: propertyB.id,
      guest_name: `Cross-Property Guest B ${suffix}`,
      guest_email: `cross-b-${suffix}@example.com`,
      check_in: '2027-08-05',
      check_out: '2027-08-08',
      adults: 2,
      children: 0,
    });
    expect(secondResponse.status()).toBe(201);
    const second: ReservationOut = await secondResponse.json();
    reservationIds.add(second.id);
  });

  // Proves cancellation actually releases the date range rather than leaving a "ghost" block: book
  // a reservation, cancel it, then immediately book a NEW reservation on the exact same
  // property_id + exact same check_in/check_out — this must succeed (201), not collide (409).
  test('POST /api/reservations after cancelling the prior booking on the same dates succeeds', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const checkIn = '2027-09-14';
    const checkOut = '2027-09-17';

    const firstResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Freed Dates Guest A ${suffix}`,
      guest_email: `freed-a-${suffix}@example.com`,
      check_in: checkIn,
      check_out: checkOut,
      adults: 2,
      children: 0,
    });
    expect(firstResponse.status()).toBe(201);
    const first: ReservationOut = await firstResponse.json();

    const cancelResponse = await vrrSteps.cancelReservation(first.id);
    expect(cancelResponse.status()).toBe(204);
    // Cancelled before the afterEach cleanup pass would see it — don't add to reservationIds.

    const secondResponse = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Freed Dates Guest B ${suffix}`,
      guest_email: `freed-b-${suffix}@example.com`,
      check_in: checkIn,
      check_out: checkOut,
      adults: 2,
      children: 0,
    });
    expect(secondResponse.status()).toBe(201);
    const second: ReservationOut = await secondResponse.json();
    reservationIds.add(second.id);
  });

  // Capacity boundary, not just over: the existing capacity test above uses max_guests + 4, which
  // never exercises the boundary itself. Confirmed live: adults === max_guests is accepted (201).
  test('POST /api/reservations accepts a guest count exactly at the property capacity', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties.find((p) => p.max_guests < 20);
    if (!property) throw new Error('No property with max_guests < 20 found — cannot construct a boundary request');

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Exact Capacity Guest ${suffix}`,
      guest_email: `exact-capacity-${suffix}@example.com`,
      check_in: '2027-05-10',
      check_out: '2027-05-12',
      adults: property.max_guests,
      children: 0,
    });
    expect(response.status()).toBe(201);
    const created: ReservationOut = await response.json();
    reservationIds.add(created.id);
  });

  // One guest over the boundary is correctly rejected. Confirmed live: adults === max_guests + 1
  // returns 422 with "Total guests (max_guests+1) exceeds property capacity (max_guests)".
  test('POST /api/reservations rejects a guest count exactly one over the property capacity', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties.find((p) => p.max_guests < 20);
    if (!property) throw new Error('No property with max_guests < 20 found — cannot construct a boundary request');

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `One Over Capacity Guest ${suffix}`,
      guest_email: `one-over-capacity-${suffix}@example.com`,
      check_in: '2027-05-15',
      check_out: '2027-05-17',
      adults: property.max_guests + 1,
      children: 0,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain(`Total guests (${property.max_guests + 1}) exceeds property capacity (${property.max_guests})`);
  });

  // Empirically confirmed live before writing this assertion (throwaway script against the real
  // API, deleted after use): booking adults = max_guests - 1 with children: 2 (so adults alone is
  // within capacity, but adults + children exceeds it) returned 422 with
  // "Total guests (max_guests+1) exceeds property capacity (max_guests)" — the server DOES count
  // children toward the "Total guests" figure, not just adults.
  test('POST /api/reservations counts children toward the total-guests capacity check', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties.find((p) => p.max_guests < 20 && p.max_guests >= 2);
    if (!property) throw new Error('No property with 2 <= max_guests < 20 found — cannot construct this request');

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const adults = property.max_guests - 1;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Children Count Guest ${suffix}`,
      guest_email: `children-count-${suffix}@example.com`,
      check_in: '2027-05-20',
      check_out: '2027-05-22',
      adults,
      children: 2,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain(`Total guests (${adults + 2}) exceeds property capacity (${property.max_guests})`);
  });

  // A completely unauthenticated context (no login call) must be rejected on a write endpoint.
  // Deliberately does NOT use the outer beforeEach/afterEach context — creates and disposes its
  // own fresh, unauthenticated one so it can't leak into or be cleaned up by the shared context.
  test('POST /api/reservations on an unauthenticated context is rejected with 401', async () => {
    const anonymousContext = await playwrightRequest.newContext();
    try {
      const anonymousSteps = new VrrSteps(anonymousContext);
      const propertiesResponse = await vrrSteps.listProperties();
      const properties: PropertyOut[] = await propertiesResponse.json();
      const property = properties[0];

      const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const response = await anonymousSteps.createReservation({
        property_id: property.id,
        guest_name: `Unauthenticated Guest ${suffix}`,
        guest_email: `unauth-${suffix}@example.com`,
        check_in: '2027-06-20',
        check_out: '2027-06-22',
        adults: 2,
        children: 0,
      });
      expect(response.status()).toBe(401);
    } finally {
      await anonymousContext.dispose();
    }
  });

  // Confirmed live: a non-existent property_id is rejected with 422 ("Property does not exist"),
  // not a 500 — the app validates the foreign key rather than letting a DB error surface.
  test('POST /api/reservations rejects a non-existent property_id with 422', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: 999999999,
      guest_name: `Bad Property Guest ${suffix}`,
      guest_email: `bad-property-${suffix}@example.com`,
      check_in: '2027-06-01',
      check_out: '2027-06-03',
      adults: 2,
      children: 0,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('Property does not exist');
  });

  // Confirmed live: adults has a server-side minimum of 1 — adults: 0 is rejected with 422
  // ("Input should be greater than or equal to 1"), not a 500 and not silently accepted as an
  // empty booking.
  test('POST /api/reservations rejects adults: 0 with 422', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Zero Adults Guest ${suffix}`,
      guest_email: `zero-adults-${suffix}@example.com`,
      check_in: '2027-06-05',
      check_out: '2027-06-07',
      adults: 0,
      children: 0,
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('Input should be greater than or equal to 1');
  });

  // Confirmed live: omitting a required field (guest_email) is rejected with 422 ("Field
  // required"), not a 500. Uses a raw object cast past the ReservationIn type since the whole
  // point is sending a body the type system would otherwise prevent.
  test('POST /api/reservations rejects a body missing a required field with 422', async () => {
    const propertiesResponse = await vrrSteps.listProperties();
    const properties: PropertyOut[] = await propertiesResponse.json();
    const property = properties[0];

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const response = await vrrSteps.createReservation({
      property_id: property.id,
      guest_name: `Missing Field Guest ${suffix}`,
      check_in: '2027-06-15',
      check_out: '2027-06-17',
      adults: 2,
      children: 0,
    } as unknown as Parameters<typeof vrrSteps.createReservation>[0]);
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('Field required');
  });
});
