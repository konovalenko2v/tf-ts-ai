import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';
import { BasePage } from './base.page';

export class AlertsPage extends BasePage {
  readonly confirmButton: Locator;
  readonly confirmResult: Locator;

  constructor(page: HealPage) {
    super(page);
    this.confirmButton = page.locator('#confirmButton');
    this.confirmResult = page.locator('#confirmResult');
  }

  async navigate() {
    await this.open(config.alertsHost);
  }

  // Playwright auto-dismisses any dialog with no listener registered before the triggering click
  // resolves, so the handler must be attached before the click, not after. `once` (not `on`) so a
  // stray later dialog on this page never gets silently auto-accepted by a leftover listener.
  async triggerConfirmAndAccept() {
    const dialogAccepted = new Promise<void>((resolve) => {
      this.page.once('dialog', (dialog) => {
        void dialog.accept().then(resolve);
      });
    });
    await this.confirmButton.click();
    await dialogAccepted;
  }
}

export async function achieve(page: HealPage): Promise<void> {
  const alertsPage = new AlertsPage(page);
  await alertsPage.navigate();
  await alertsPage.triggerConfirmAndAccept();
}
