import { HealPage } from 'healwright';

// Only the boilerplate that was duplicated verbatim across page objects (ad-block + goto). It
// deliberately does NOT touch how pages hold or call locators — heal.click(this.page.locator(...))
// call sites are matched literally by agent-fixer (src/agent-fixer/run.ts) and must stay
// unmodified letter for letter.
export class BasePage {
  constructor(protected readonly page: HealPage) {}

  protected async blockAds(): Promise<void> {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
  }

  protected async open(url: string): Promise<void> {
    await this.blockAds();
    await this.page.goto(url);
  }
}
