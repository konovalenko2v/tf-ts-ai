import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { CheckBoxPage } from '../pages/check-box.page';

export class CheckBoxSteps {
  readonly checkBoxPage: CheckBoxPage;

  constructor(page: HealPage) {
    this.checkBoxPage = new CheckBoxPage(page);
  }

  async openCheckBoxPage() {
    await test.step('Open the check box page', async () => this.checkBoxPage.navigate());
  }

  async expandTree() {
    await test.step('Expand the entire folder tree', async () => this.checkBoxPage.expandAll());
  }

  async toggle(label: string) {
    await test.step(`Toggle the "${label}" checkbox`, async () => this.checkBoxPage.toggleCheckbox(label));
  }

  async collapse(label: string) {
    await test.step(`Collapse the "${label}" node`, async () => this.checkBoxPage.collapse(label));
  }

  async expand(label: string) {
    await test.step(`Expand the "${label}" node`, async () => this.checkBoxPage.expand(label));
  }

  async verifySelected(ids: string[]) {
    await test.step(`Verify selected items: ${ids.join(', ')}`, async () => {
      for (const id of ids) {
        await expect(this.checkBoxPage.selectedItem(id)).toBeVisible();
      }
    });
  }

  async verifyParentIndeterminate(label: string) {
    await test.step(`Verify "${label}" shows a partial (indeterminate) selection`, async () => {
      await expect(this.checkBoxPage.checkboxState(label)).toHaveClass(/rc-tree-checkbox-indeterminate/);
    });
  }

  async verifyParentFullyChecked(label: string) {
    await test.step(`Verify "${label}" is fully checked (not partial)`, async () => {
      await expect(this.checkBoxPage.checkboxState(label)).toHaveClass(/rc-tree-checkbox-checked/);
      await expect(this.checkBoxPage.checkboxState(label)).not.toHaveClass(/rc-tree-checkbox-indeterminate/);
    });
  }

  async verifyNoSelection() {
    await test.step('Verify no result block is rendered when nothing is selected', async () => {
      await expect(this.checkBoxPage.result).toHaveCount(0);
    });
  }

  async verifyNotSelected(ids: string[]) {
    await test.step(`Verify not selected: ${ids.join(', ')}`, async () => {
      for (const id of ids) {
        await expect(this.checkBoxPage.selectedItem(id)).toHaveCount(0);
      }
    });
  }
}
