import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { Response } from '@playwright/test';
import { VrrPage } from '../pages/vrr.page';

export class VrrSteps {
  readonly vrrPage: VrrPage;

  constructor(page: HealPage) {
    this.vrrPage = new VrrPage(page);
  }

  async openLoginPage() {
    await test.step('Open the VRR login page', async () => this.vrrPage.navigateToLogin());
  }

  async loginAs(username: string, password: string) {
    await test.step(`Log in as "${username}"`, async () => this.vrrPage.login(username, password));
  }

  async logout() {
    await test.step('Log out', async () => this.vrrPage.logout());
  }

  async verifyLoggedInAs(username: string) {
    await test.step(`Verify logged in as "${username}"`, async () => {
      await expect(this.vrrPage.currentUser).toContainText(username);
    });
  }

  async verifyLoggedOut() {
    await test.step('Verify the login form is shown again', async () => {
      await expect(this.vrrPage.loginSubmitButton).toBeVisible();
      await expect(this.vrrPage.currentUser).toBeHidden();
    });
  }

  async fillReservationForm(fields: {
    property: string;
    guestName: string;
    guestEmail: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children?: number;
  }) {
    await test.step(`Fill reservation form for "${fields.property}"`, async () => this.vrrPage.fillReservationForm(fields));
  }

  // Returns the response (mirrors VrrPage#submitReservation) so a caller can assert on status/body
  // — e.g. a bad-date submission's 422/409, or reading a created reservation's id back out of a
  // 201 — without every existing call site that ignores the return value having to change.
  async submitReservation(): Promise<Response> {
    return test.step('Submit the reservation form', async () => this.vrrPage.submitReservation());
  }

  async verifyAdultsCapacityError(expectedText: string) {
    await test.step(`Verify capacity error: "${expectedText}"`, async () => {
      await expect(this.vrrPage.adultsError).toHaveText(expectedText);
    });
  }

  async verifyCheckOutError(expectedText: string) {
    await test.step(`Verify check-out error: "${expectedText}"`, async () => {
      await expect(this.vrrPage.checkOutError).toHaveText(expectedText);
    });
  }

  async verifyCheckInError(expectedText: string) {
    await test.step(`Verify check-in error: "${expectedText}"`, async () => {
      await expect(this.vrrPage.checkInError).toHaveText(expectedText);
    });
  }

  async verifyEstimatedTotal(expectedText: string) {
    await test.step(`Verify estimated total: "${expectedText}"`, async () => {
      await expect(this.vrrPage.estimatedTotal).toHaveText(expectedText);
    });
  }

  async verifyReservationVisible(guestEmail: string) {
    await test.step(`Verify a reservation for "${guestEmail}" is visible in the table`, async () => {
      await expect(this.vrrPage.reservationRowByGuestEmail(guestEmail)).toBeVisible();
    });
  }

  async cancelReservationByGuestEmail(guestEmail: string) {
    await test.step(`Cancel the reservation for "${guestEmail}"`, async () => {
      const row = this.vrrPage.reservationRowByGuestEmail(guestEmail);
      await this.vrrPage.cancelReservationRow(row);
      await expect(row).toHaveCount(0);
    });
  }

  async filterByProperty(label: string) {
    await test.step(`Filter reservations by property "${label}"`, async () => this.vrrPage.selectPropertyFilter(label));
  }

  async filterByStatus(label: string) {
    await test.step(`Filter reservations by status "${label}"`, async () => this.vrrPage.selectStatusFilter(label));
  }

  // Soft asserts every field so one mismatch (e.g. a wrong date) doesn't hide a second, unrelated
  // one (e.g. a wrong guest count) in the same run — each is reported independently, and the test
  // still fails overall if any assertion in the step failed (Playwright tracks soft failures per
  // test, not per test.step).
  async verifyRowMatchesInput(
    guestEmail: string,
    expected: {
      property: string;
      guestName: string;
      checkIn: string;
      checkOut: string;
      nights: number;
      nightlyRate: number;
      adults: number;
      children: number;
      status: string;
    },
  ) {
    await test.step(`Verify the table row for "${guestEmail}" matches every submitted field`, async () => {
      const row = this.vrrPage.reservationRowByGuestEmail(guestEmail);
      await expect(row).toBeVisible();

      expect.soft(await this.vrrPage.rowProperty(row).innerText()).toBe(expected.property);
      expect.soft(await this.vrrPage.rowGuestName(row).innerText()).toBe(expected.guestName);
      expect.soft(await this.vrrPage.rowGuestEmail(row).innerText()).toBe(guestEmail);

      const datesText = await this.vrrPage.rowDates(row).innerText();
      expect.soft(datesText).toContain(`${expected.checkIn} → ${expected.checkOut}`);
      expect.soft(datesText).toContain(`${expected.nights} night${expected.nights === 1 ? '' : 's'}`);

      const guestsText = await this.vrrPage.rowGuestCounts(row).innerText();
      const expectedGuests = expected.children > 0 ? `${expected.adults}A · ${expected.children}C` : `${expected.adults}A`;
      expect.soft(guestsText).toBe(expectedGuests);

      // Confirmed live: the table cell is a plain "$<amount>.00" (toFixed(2)-style, no thousands
      // separator even above $1000 — observed "$50820.00" on the shared instance) — a different,
      // simpler format than the "N nights × $rate = $total" preview shown on the form before submit.
      const expectedTotal = `$${(expected.nights * expected.nightlyRate).toFixed(2)}`;
      expect.soft(await this.vrrPage.rowTotal(row).innerText()).toBe(expectedTotal);

      expect
        .soft(await this.vrrPage.rowStatusBadge(row).innerText())
        .toBe(expected.status.charAt(0).toUpperCase() + expected.status.slice(1));
    });
  }
}
