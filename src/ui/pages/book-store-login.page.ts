import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class BookStoreLoginPage {
  readonly userNameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loggedInUserName: Locator;
  readonly profileRows: Locator;

  constructor(private readonly page: HealPage) {
    this.userNameInput = page.locator('#userName');
    this.passwordInput = page.locator('#password');
    this.loginButton = page.locator('#login');
    this.loggedInUserName = page.locator('#userName-value');
    this.profileRows = page.locator('tbody tr');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(`${config.bookStoreHost}/login`);
  }

  async login(userName: string, password: string) {
    await this.userNameInput.fill(userName);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
    await this.page.waitForURL(/\/profile$/);
  }

  bookRow(title: string): Locator {
    return this.profileRows.filter({ has: this.page.locator(`[id="see-book-${title}"]`) });
  }
}
