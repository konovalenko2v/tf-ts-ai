import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { TextBoxPage } from '../pages/text-box.page';

export class TextBoxSteps {
  readonly textBoxPage: TextBoxPage;

  constructor(page: HealPage) {
    this.textBoxPage = new TextBoxPage(page);
  }

  async openTextBoxPage() {
    await test.step('Open the text box page', async () => this.textBoxPage.navigate());
  }

  async fillForm(fields: { name?: string; email?: string; currentAddress?: string; permanentAddress?: string }) {
    await test.step('Fill the text box form', async () => this.textBoxPage.fillForm(fields));
  }

  async submitForm() {
    await test.step('Submit the form', async () => this.textBoxPage.submit());
  }

  async verifyOutput(fields: { name?: string; email?: string; currentAddress?: string; permanentAddress?: string }) {
    await test.step('Verify the submitted values are echoed back', async () => {
      if (fields.name !== undefined) {
        await expect(this.textBoxPage.outputField('name')).toHaveText(`Name:${fields.name}`);
      }
      if (fields.email !== undefined) {
        await expect(this.textBoxPage.outputField('email')).toHaveText(`Email:${fields.email}`);
      }
      if (fields.currentAddress !== undefined) {
        await expect(this.textBoxPage.outputField('currentAddress')).toHaveText(`Current Address :${fields.currentAddress} `);
      }
      if (fields.permanentAddress !== undefined) {
        await expect(this.textBoxPage.outputField('permanentAddress')).toHaveText(`Permananet Address :${fields.permanentAddress}`);
      }
    });
  }

  async verifyNoOutputRendered() {
    await test.step('Verify no output block was rendered', async () => {
      await expect(this.textBoxPage.outputHasBorder()).toHaveCount(0);
    });
  }

  async verifyEmailRejected() {
    await test.step('Verify the email field is marked invalid and no output is rendered', async () => {
      await expect
        .poll(() => this.textBoxPage.emailHasError(), { message: 'expected #userEmail to carry the field-error class' })
        .toBe(true);
      await expect(this.textBoxPage.outputField('email')).toHaveCount(0);
    });
  }
}
