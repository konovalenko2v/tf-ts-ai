import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';
import { BasePage } from './base.page';

export class VrrPage extends BasePage {
  readonly loginUsernameInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginSubmitButton: Locator;

  readonly propertySelect: Locator;
  readonly guestNameInput: Locator;
  readonly guestEmailInput: Locator;
  readonly checkInInput: Locator;
  readonly checkOutInput: Locator;
  readonly adultsInput: Locator;
  readonly childrenInput: Locator;
  readonly adultsError: Locator;
  readonly checkInError: Locator;
  readonly checkOutError: Locator;
  readonly estimatedTotal: Locator;
  readonly submitButton: Locator;

  readonly filterProperty: Locator;
  readonly filterStatus: Locator;
  readonly reservationsTable: Locator;
  readonly reservationsTbody: Locator;

  readonly logoutButton: Locator;
  readonly currentUser: Locator;

  constructor(page: HealPage) {
    super(page);
    this.loginUsernameInput = page.locator('[data-testid="login-username"]');
    this.loginPasswordInput = page.locator('[data-testid="login-password"]');
    this.loginSubmitButton = page.locator('[data-testid="login-submit"]');

    this.propertySelect = page.locator('[data-testid="input-property"]');
    this.guestNameInput = page.locator('[data-testid="input-guest-name"]');
    this.guestEmailInput = page.locator('[data-testid="input-guest-email"]');
    this.checkInInput = page.locator('[data-testid="input-check-in"]');
    this.checkOutInput = page.locator('[data-testid="input-check-out"]');
    this.adultsInput = page.locator('[data-testid="input-adults"]');
    this.childrenInput = page.locator('[data-testid="input-children"]');
    this.adultsError = page.locator('[data-testid="error-adults"]');
    // Confirmed live: same-day/backwards check_out both surface on error-check_out ("check_out
    // must be after check_in"), while an overlap conflict (409) surfaces on error-check_in instead
    // ("Property is already booked from ... (reservation #N)") — not a typo, the app puts the
    // overlap message on the check-in field specifically.
    this.checkInError = page.locator('[data-testid="error-check_in"]');
    this.checkOutError = page.locator('[data-testid="error-check_out"]');
    this.estimatedTotal = page.locator('[data-testid="estimated-total"]');
    this.submitButton = page.locator('[data-testid="submit-btn"]');

    this.filterProperty = page.locator('[data-testid="filter-property"]');
    this.filterStatus = page.locator('[data-testid="filter-status"]');
    this.reservationsTable = page.locator('[data-testid="reservations-table"]');
    this.reservationsTbody = page.locator('[data-testid="reservations-tbody"]');

    this.logoutButton = page.locator('[data-testid="logout-btn"]');
    this.currentUser = page.locator('[data-testid="current-user"]');
  }

  async navigateToLogin() {
    await this.open(config.vrrLoginHost);
  }

  async login(username: string, password: string) {
    await this.loginUsernameInput.fill(username);
    await this.loginPasswordInput.fill(password);
    await this.loginSubmitButton.click();
    await this.currentUser.waitFor({ state: 'visible' });
  }

  async logout() {
    await this.logoutButton.click();
    await this.loginSubmitButton.waitFor({ state: 'visible' });
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
    await this.propertySelect.selectOption({ label: fields.property });
    await this.guestNameInput.fill(fields.guestName);
    await this.guestEmailInput.fill(fields.guestEmail);
    await this.checkInInput.fill(fields.checkIn);
    await this.checkOutInput.fill(fields.checkOut);
    await this.adultsInput.fill(String(fields.adults));
    if (fields.children !== undefined) {
      await this.childrenInput.fill(String(fields.children));
    }
  }

  // Waits for the actual POST /api/reservations response before returning — without it, a caller
  // that immediately looks for the new row in the table races the table's own refetch and finds
  // nothing (confirmed live: the row assertion failed intermittently until this wait was added).
  //
  // Returns the response so callers CAN check status/body (e.g. asserting a 422/409 rejection, or
  // reading the created reservation's id back out of a 201) — existing callers that ignore the
  // return value are unaffected. Without this, a bad-date submission that gets rejected server-side
  // is indistinguishable from a network hiccup: both just leave no new row in the table.
  async submitReservation() {
    const responsePromise = this.page.waitForResponse((r) => r.url().endsWith('/api/reservations') && r.request().method() === 'POST');
    await this.submitButton.click();
    return responsePromise;
  }

  // The table row a just-created reservation lands in has no way to be addressed except by the
  // data it displays — the app assigns the DOM id (reservation-row-{id}) only after the server
  // responds, so a caller here can only search by guest email, not predict the id ahead of time.
  reservationRowByGuestEmail(email: string): Locator {
    return this.reservationsTbody.locator('tr').filter({ hasText: email });
  }

  // Cell-column order is fixed by the table's own <thead> (Property, Guest, Dates, Guests, Total,
  // Status, actions) — read live, not guessed, via read_page against the real table. Exposed as
  // named accessors on a row rather than raw td-index calls at every call site, so a column
  // reorder in the app only breaks one place.
  rowProperty(row: Locator): Locator {
    return row.locator('td').nth(0);
  }

  rowGuestName(row: Locator): Locator {
    return row.locator('td').nth(1).locator('div').first();
  }

  rowGuestEmail(row: Locator): Locator {
    return row.locator('td').nth(1).locator('div').nth(1);
  }

  rowDates(row: Locator): Locator {
    return row.locator('td').nth(2);
  }

  rowGuestCounts(row: Locator): Locator {
    return row.locator('td').nth(3);
  }

  rowTotal(row: Locator): Locator {
    return row.locator('td').nth(4);
  }

  rowStatusBadge(row: Locator): Locator {
    return row.locator('[data-testid="badge-status"]');
  }

  // Waits on the actual re-fetch request the filter triggers (confirmed live via the network
  // tab: selecting a filter fires GET /api/reservations?...&<param>=<value>) rather than a
  // fixed sleep — a hardcoded wait is banned by this repo's page-object rules (CLAUDE.md #7)
  // and would be flaky in either direction: too short races the table update, too long is dead
  // time on every run.
  async selectPropertyFilter(label: string) {
    const responsePromise = this.page.waitForResponse((r) => r.url().includes('/api/reservations') && /[?&]property_id=/.test(r.url()));
    await this.filterProperty.selectOption({ label });
    await responsePromise;
  }

  async selectStatusFilter(label: string) {
    const responsePromise = this.page.waitForResponse((r) => r.url().includes('/api/reservations') && /[?&]status=/.test(r.url()));
    await this.filterStatus.selectOption({ label });
    await responsePromise;
  }

  // The Cancel button triggers a native confirm() dialog ("Cancel this reservation?") — confirmed
  // live via the dialog event. Playwright auto-dismisses any dialog with no listener attached
  // (its documented default), which silently cancels the action before the DELETE is ever sent;
  // an unguarded click here produced a full 60s waitForResponse timeout with zero network
  // activity, not a same-page failure, which is what actually exposed this. The listener must be
  // registered before the click that opens the dialog, and 'once' is correct since only one
  // dialog is expected per call.
  //
  // Also mirrors submitReservation()'s wait for the actual response — without it, a caller that
  // immediately asserts the row is gone can race the table's own re-render and see the stale row
  // still present.
  async cancelReservationRow(row: Locator) {
    this.page.once('dialog', (dialog) => dialog.accept());
    const responsePromise = this.page.waitForResponse(
      (r) => /\/api\/reservations\/\d+$/.test(r.url()) && r.request().method() === 'DELETE',
    );
    await row.getByRole('button', { name: /Cancel reservation/ }).click();
    await responsePromise;
  }
}
