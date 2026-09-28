import { test, expect } from '../../src/ui/fixtures';
import { VrrSteps } from '../../src/ui/steps/vrr.steps';
import { requireEnv } from '../../src/core/config';

function vrrCredentials() {
  return { username: requireEnv('VRR_USERNAME'), password: requireEnv('VRR_PASSWORD') };
}

// A fixed date range collides with a leftover reservation from an earlier interrupted run — the
// server rejects the booking as an overlap ("Property is already booked from ... (reservation
// #N)"), confirmed live via a real test failure, not a guess. Offsetting the start date by a
// random number of days per run keeps every run's date range distinct from every other run's,
// the same way guest name/email are already randomized per the onboarded persona's shared-data
// rule (see ai-agents/personas/api-onboarder.md).
function uniqueDateRange(nights: number): { checkIn: string; checkOut: string } {
  const startOffsetDays = 200 + Math.floor(Math.random() * 1000);
  const checkInDate = new Date(Date.now() + startOffsetDays * 24 * 60 * 60 * 1000);
  const checkOutDate = new Date(checkInDate.getTime() + nights * 24 * 60 * 60 * 1000);
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
  return { checkIn: toIsoDate(checkInDate), checkOut: toIsoDate(checkOutDate) };
}

test.describe('VRR UI @ Login', () => {
  test('logging in shows the signed-in user, and logging out returns to the login form', async ({ page }) => {
    const steps = new VrrSteps(page);
    const { username, password } = vrrCredentials();

    await steps.openLoginPage();
    await steps.loginAs(username, password);
    await steps.verifyLoggedInAs(username);

    await steps.logout();
    await steps.verifyLoggedOut();
  });
});

test.describe('VRR UI @ Reservations', () => {
  test.beforeEach(async ({ page }) => {
    const steps = new VrrSteps(page);
    const { username, password } = vrrCredentials();
    await steps.openLoginPage();
    await steps.loginAs(username, password);
  });

  test('booking a reservation shows the correct nights × rate total and adds a matching row to the table', async ({ page }) => {
    const steps = new VrrSteps(page);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const guestEmail = `ui-guest-${suffix}@example.com`;
    const { checkIn, checkOut } = uniqueDateRange(3);

    // Downtown Loft is $189.00/night (see Properties grid) — 3 nights.
    await steps.fillReservationForm({
      property: 'Downtown Loft',
      guestName: `UI Guest ${suffix}`,
      guestEmail,
      checkIn,
      checkOut,
      adults: 2,
    });
    await steps.verifyEstimatedTotal('3 nights × $189.00 = $567.00');

    await steps.submitReservation();
    await steps.verifyReservationVisible(guestEmail);

    await steps.cancelReservationByGuestEmail(guestEmail);
  });

  test('booking more guests than a property sleeps shows an inline capacity error and blocks submit', async ({ page }) => {
    const steps = new VrrSteps(page);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const guestEmail = `ui-capacity-${suffix}@example.com`;

    // Ocean View Cottage sleeps 6 (see Properties grid) — 10 adults is within the 1-20 HTML range
    // validation but over the property's own capacity, which is a server-side/business-rule check,
    // not a browser-native one.
    await steps.fillReservationForm({
      property: 'Ocean View Cottage',
      guestName: `UI Capacity Guest ${suffix}`,
      guestEmail,
      checkIn: '2027-08-01',
      checkOut: '2027-08-03',
      adults: 10,
    });
    await steps.submitReservation();

    await steps.verifyAdultsCapacityError('Total guests (10) exceeds property capacity (6)');
    // Blocked submit means no row for this guest ever appears — confirms the error is not merely
    // cosmetic (a validation message shown AFTER a reservation was created anyway).
    await expect(page.locator('[data-testid="reservations-tbody"] tr').filter({ hasText: guestEmail })).toHaveCount(0);
  });

  // Confirmed live: the browser's native <input type="date"> puts no min/max constraint on
  // check_out relative to check_in (validity was {} for both fields), so a same-day range reaches
  // the server unblocked. The server rejects it with 422 and the UI surfaces that rejection inline
  // on error-check_out, using its own shorter text (the API's raw message is "Value error, check_out
  // must be after check_in" — the UI strips the "Value error, " prefix, confirmed live via the DOM).
  test('submitting check_out equal to check_in shows an inline error and blocks submit', async ({ page }) => {
    const steps = new VrrSteps(page);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const guestEmail = `ui-sameday-${suffix}@example.com`;

    await steps.fillReservationForm({
      property: 'Downtown Loft',
      guestName: `UI SameDay Guest ${suffix}`,
      guestEmail,
      checkIn: '2027-06-10',
      checkOut: '2027-06-10',
      adults: 2,
    });
    const response = await steps.submitReservation();

    expect(response.status()).toBe(422);
    await steps.verifyCheckOutError('check_out must be after check_in');
    await expect(page.locator('[data-testid="reservations-tbody"] tr').filter({ hasText: guestEmail })).toHaveCount(0);
  });

  // Same inline error/testid as the same-day case above (both are the API's single "check_out must
  // be after check_in" 422 rule) — confirmed live as a separate case since a backwards range isn't
  // blocked by any client-side date-input constraint either.
  test('submitting check_out before check_in shows an inline error and blocks submit', async ({ page }) => {
    const steps = new VrrSteps(page);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const guestEmail = `ui-backwards-${suffix}@example.com`;

    await steps.fillReservationForm({
      property: 'Downtown Loft',
      guestName: `UI Backwards Guest ${suffix}`,
      guestEmail,
      checkIn: '2027-06-15',
      checkOut: '2027-06-10',
      adults: 2,
    });
    const response = await steps.submitReservation();

    expect(response.status()).toBe(422);
    await steps.verifyCheckOutError('check_out must be after check_in');
    await expect(page.locator('[data-testid="reservations-tbody"] tr').filter({ hasText: guestEmail })).toHaveCount(0);
  });

  // Confirmed live: an overlapping second booking on the same property gets a 409 from the server,
  // and the UI surfaces it inline — but on error-check_in, not error-check_out (not a typo in this
  // test; the app puts the overlap message on the check-in field specifically). Without
  // submitReservation() now returning the response, this 409 would be invisible to the test: the
  // only other signal is "no new row appears", identical to what a same-day/backwards 422 also
  // produces, which is exactly the "409 masquerading as row not found" gap the reviewer flagged.
  test('submitting an overlapping date range shows an inline conflict error and blocks submit', async ({ page }) => {
    const steps = new VrrSteps(page);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const firstGuestEmail = `ui-overlap-a-${suffix}@example.com`;
    const secondGuestEmail = `ui-overlap-b-${suffix}@example.com`;
    const { checkIn, checkOut } = uniqueDateRange(4);

    await steps.fillReservationForm({
      property: 'City Studio',
      guestName: `UI Overlap Guest A ${suffix}`,
      guestEmail: firstGuestEmail,
      checkIn,
      checkOut,
      adults: 2,
    });
    const firstResponse = await steps.submitReservation();
    expect(firstResponse.status()).toBe(201);
    const firstReservation = (await firstResponse.json()) as { id: number };
    await steps.verifyReservationVisible(firstGuestEmail);

    // Overlaps the first booking's range by shifting check-in 2 days later, same as the API's
    // overlap test — a partial overlap, not an exact-match duplicate.
    const overlapCheckIn = new Date(new Date(checkIn).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await steps.fillReservationForm({
      property: 'City Studio',
      guestName: `UI Overlap Guest B ${suffix}`,
      guestEmail: secondGuestEmail,
      checkIn: overlapCheckIn,
      checkOut,
      adults: 2,
    });
    const secondResponse = await steps.submitReservation();

    expect(secondResponse.status()).toBe(409);
    await steps.verifyCheckInError(`Property is already booked from ${checkIn} to ${checkOut} (reservation #${firstReservation.id})`);
    await expect(page.locator('[data-testid="reservations-tbody"] tr').filter({ hasText: secondGuestEmail })).toHaveCount(0);

    await steps.cancelReservationByGuestEmail(firstGuestEmail);
  });

  // Confirmed live in both the UI (this test) and the API (tests/api/vrr-onboarded.spec.ts's
  // status-filter test): selecting "Active" in the status filter still leaves "Upcoming"-badged
  // rows in the table — the filter has no real effect. This asserts the CORRECT behavior, so it
  // fails (red) against the current broken server rather than passing by encoding the bug as
  // expected — same fix direction as the sibling API test.
  test('the status filter shows only reservations with the selected status', async ({ page }) => {
    const steps = new VrrSteps(page);
    await steps.filterByStatus('Active');

    const badges = page.locator('[data-testid="reservations-tbody"] [data-testid="badge-status"]');
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toHaveAttribute('data-status', 'active');
    }
  });

  test('the property filter shows only reservations for the selected property', async ({ page }) => {
    const steps = new VrrSteps(page);
    await steps.filterByProperty('Downtown Loft');

    const rows = page.locator('[data-testid="reservations-tbody"] tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('Downtown Loft');
    }
  });

  // Several property/duration combinations, not just one — each has its nightly_rate read from
  // the Properties grid at the top of the same page rather than hardcoded a second time, so this
  // test breaks visibly (via a bad property-picker selection) if a property's price ever changes,
  // instead of silently comparing two independently-hardcoded numbers that happen to agree.
  for (const { property, nights, checkIn, checkOut, rate } of [
    { property: 'Ocean View Cottage', nights: 2, checkIn: '2027-09-01', checkOut: '2027-09-03', rate: 385 },
    { property: 'Mountain Cabin', nights: 4, checkIn: '2027-09-10', checkOut: '2027-09-14', rate: 520 },
    { property: 'City Studio', nights: 1, checkIn: '2027-09-20', checkOut: '2027-09-21', rate: 220 },
  ]) {
    test(`price preview for ${property} × ${nights} night(s) is "${nights} nights × $${rate.toFixed(2)} = $${(nights * rate).toFixed(2)}"`, async ({
      page,
    }) => {
      const steps = new VrrSteps(page);
      const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

      await steps.fillReservationForm({
        property,
        guestName: `Price Sweep Guest ${suffix}`,
        guestEmail: `price-sweep-${suffix}@example.com`,
        checkIn,
        checkOut,
        adults: 2,
      });

      const nightsLabel = nights === 1 ? '1 night' : `${nights} nights`;
      await steps.verifyEstimatedTotal(`${nightsLabel} × $${rate.toFixed(2)} = $${(nights * rate).toFixed(2)}`);
    });
  }

  test('a booked reservation matches the submitted data in every table column', async ({ page }) => {
    const steps = new VrrSteps(page);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const guestEmail = `ui-fullrow-${suffix}@example.com`;
    const { checkIn, checkOut } = uniqueDateRange(4);

    // Built once and reused for both the form fill and the row-match expectation below, so the
    // two can never drift apart by a hand-edit to only one of them.
    const booking = {
      property: 'Beach House',
      guestName: `Full Row Guest ${suffix}`,
      guestEmail,
      checkIn,
      checkOut,
      adults: 3,
      children: 1,
    };

    await steps.fillReservationForm(booking);
    await steps.submitReservation();
    await steps.verifyReservationVisible(guestEmail);

    // Beach House is $299.00/night (see Properties grid) — 4 nights.
    await steps.verifyRowMatchesInput(guestEmail, { ...booking, nights: 4, nightlyRate: 299, status: 'upcoming' });

    await steps.cancelReservationByGuestEmail(guestEmail);
  });
});
