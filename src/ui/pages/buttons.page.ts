import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';
import { BasePage } from './base.page';

export class ButtonsPage extends BasePage {
  readonly clickMeButton: Locator;
  readonly doubleClickButton: Locator;
  readonly rightClickButton: Locator;
  readonly dynamicClickMessage: Locator;
  readonly doubleClickMessage: Locator;
  readonly rightClickMessage: Locator;

  constructor(page: HealPage) {
    super(page);
    this.clickMeButton = page.getByRole('button', { name: 'Click Me', exact: true });
    this.doubleClickButton = page.locator('#doubleClickBtn');
    this.rightClickButton = page.locator('#rightClickBtn');
    this.dynamicClickMessage = page.locator('#dynamicClickMessage');
    this.doubleClickMessage = page.locator('#doubleClickMessage');
    this.rightClickMessage = page.locator('#rightClickMessage');
  }

  async navigate() {
    await this.open(config.buttonsHost);
  }

  async clickDynamicButton() {
    await this.clickMeButton.click();
  }

  async doubleClick() {
    await this.doubleClickButton.dblclick();
  }

  async rightClick() {
    await this.rightClickButton.click({ button: 'right' });
  }
}

export async function achieve(page: HealPage): Promise<void> {
  const buttonsPage = new ButtonsPage(page);
  await buttonsPage.navigate();
  await buttonsPage.clickDynamicButton();
}
