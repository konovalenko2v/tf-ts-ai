import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class LinksPage {
  readonly movedLink: Locator;
  readonly linkResponse: Locator;

  constructor(private readonly page: HealPage) {
    this.movedLink = page.locator('#moved');
    this.linkResponse = page.locator('#linkResponse');
  }

  async navigate() {
    await this.page.goto(config.linksHost);
  }

  // #moved is `href="javascript:throw new Error(...)"`, not a real link — clicking runs a React
  // onClick handler that updates #linkResponse in place. There is no navigation to wait for.
  async clickMoved() {
    await this.movedLink.click();
  }

  async responseText(): Promise<string> {
    return (await this.linkResponse.textContent()) ?? '';
  }
}
