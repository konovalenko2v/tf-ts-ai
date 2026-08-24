import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class TextBoxPage {
  readonly userNameInput: Locator;
  readonly userEmailInput: Locator;
  readonly currentAddressInput: Locator;
  readonly permanentAddressInput: Locator;
  readonly submitButton: Locator;
  readonly output: Locator;

  constructor(private readonly page: HealPage) {
    this.userNameInput = page.locator('#userName');
    this.userEmailInput = page.locator('#userEmail');
    this.currentAddressInput = page.locator('#currentAddress');
    this.permanentAddressInput = page.locator('#permanentAddress');
    this.submitButton = page.locator('#submit');
    this.output = page.locator('#output');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(config.textBoxHost);
  }

  async fillForm(fields: { name?: string; email?: string; currentAddress?: string; permanentAddress?: string }) {
    if (fields.name !== undefined) await this.userNameInput.fill(fields.name);
    if (fields.email !== undefined) await this.userEmailInput.fill(fields.email);
    if (fields.currentAddress !== undefined) await this.currentAddressInput.fill(fields.currentAddress);
    if (fields.permanentAddress !== undefined) await this.permanentAddressInput.fill(fields.permanentAddress);
  }

  async submit() {
    await this.submitButton.click();
  }

  // #output keeps stale text from the last successful submit and doesn't clear itself, so every
  // field here is scoped inside #output rather than reused from the input locators above — the
  // output <p id="currentAddress"> and the input #currentAddress share the exact same id.
  outputField(field: 'name' | 'email' | 'currentAddress' | 'permanentAddress'): Locator {
    return this.output.locator(`#${field}`);
  }

  // A submit with every field empty still creates #output, but without the bordered wrapper div
  // and with no child <p> elements at all — this is what "nothing was recorded" looks like here,
  // distinct from the field-error case below where #output is simply left unchanged.
  outputHasBorder(): Locator {
    return this.output.locator('.border');
  }

  // An invalid email marks the input itself with a `field-error` class and leaves #output exactly
  // as it was before this submit (no error text is rendered anywhere in the DOM) — this is the
  // only user-visible signal that the submit was rejected.
  async emailHasError(): Promise<boolean> {
    const classAttr = (await this.userEmailInput.getAttribute('class')) ?? '';
    return classAttr.includes('field-error');
  }
}
// verification touch — will be reverted after CI check
