import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class CheckBoxPage {
  readonly homeExpandToggle: Locator;
  readonly result: Locator;

  constructor(private readonly page: HealPage) {
    this.homeExpandToggle = page.locator('.rc-tree-treenode', { hasText: 'Home' }).first().locator('.rc-tree-switcher');
    this.result = page.locator('#result');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(config.checkBoxHost);
  }

  async expandAll() {
    // No single "expand all" control in this markup — repeatedly click every still-collapsed
    // switcher until none remain, since expanding a node reveals new (still-collapsed) children.
    for (let i = 0; i < 10; i++) {
      const closedSwitchers = this.page.locator('.rc-tree-switcher_close');
      const count = await closedSwitchers.count();
      if (count === 0) break;
      for (let j = 0; j < count; j++) {
        await closedSwitchers.nth(0).click();
      }
    }
  }

  private treeNode(label: string): Locator {
    return this.page.locator('.rc-tree-treenode', { hasText: label }).filter({ has: this.page.locator('.rc-tree-title', { hasText: label }) });
  }

  async toggleCheckbox(label: string) {
    await this.treeNode(label).locator('.rc-tree-checkbox').first().click();
  }

  checkboxState(label: string): Locator {
    return this.treeNode(label).locator('.rc-tree-checkbox').first();
  }

  // #result renders each selected node's internal id (e.g. "wordFile"), not its displayed tree
  // label ("Word File.doc") — callers pass the id here, not the label shown in the tree.
  selectedItem(id: string): Locator {
    return this.result.locator(`text=${id}`);
  }

  async resultText(): Promise<string> {
    return (await this.result.count()) > 0 ? ((await this.result.textContent()) ?? '') : '';
  }
}
