import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class ButtonsPage {
  readonly clickMeButton: Locator;
  readonly doubleClickButton: Locator;
  readonly rightClickButton: Locator;
  readonly dynamicClickMessage: Locator;
  readonly doubleClickMessage: Locator;
  readonly rightClickMessage: Locator;

  constructor(private readonly page: HealPage) {
    this.clickMeButton = page.getByRole('button', { name: 'Click Me', exact: true });
    this.doubleClickButton = page.locator('#doubleClickBtn');
    this.rightClickButton = page.locator('#rightClickBtn');
    this.dynamicClickMessage = page.locator('#dynamicClickMessage');
    this.doubleClickMessage = page.locator('#doubleClickMessage');
    this.rightClickMessage = page.locator('#rightClickMessage');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(config.buttonsHost);
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
