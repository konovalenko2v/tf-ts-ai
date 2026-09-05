import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { LinksPage } from '../pages/links.page';

export class LinksSteps {
  readonly linksPage: LinksPage;

  constructor(page: HealPage) {
    this.linksPage = new LinksPage(page);
  }

  async openLinksPage() {
    await test.step('Open the links page', async () => this.linksPage.navigate());
  }

  async clickMovedLink() {
    await test.step('Click the "Moved" link', async () => this.linksPage.clickMoved());
  }

  async verifyMovedResponse() {
    await test.step('Verify the response reports 301 Moved Permanently', async () => {
      // "staus" is the live site's own typo, not a mistake here — see docs/page-knowledge/links.md.
      await expect(this.linksPage.linkResponse).toHaveText('Link has responded with staus 301 and status text Moved Permanently');
    });
  }
}
