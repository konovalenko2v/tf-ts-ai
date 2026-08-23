import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export class PracticeFormPage {
  readonly modalTitle: Locator;

  constructor(private readonly page: HealPage) {
    this.modalTitle = page.locator('#example-modal-sizes-title-lg');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(config.uiHost);
  }

  async fillMainPersonalDetails(firstName: string, lastName: string, email: string, phone: string) {
    await this.page.locator('#firstName').fill(firstName);
    await this.page.locator('#lastName').fill(lastName);
    await this.page.locator('#userEmail').fill(email);
    await this.page.locator("label[for='gender-radio-1']").click();
    await this.page.locator('#userNumber').fill(phone);
  }

  async selectDateOfBirth(monthValue: string, yearValue: string) {
    await this.page.locator('#dateOfBirthInput').click();
    await this.page.locator('.react-datepicker__month-select').selectOption(monthValue);
    await this.page.locator('.react-datepicker__year-select').selectOption(yearValue);
    await this.page.locator('.react-datepicker__day--015:not(.react-datepicker__day--outside-month)').click();
  }

  async addSubjectAndHobby(subjectPrefix: string) {
    await this.page.locator('#subjectsInput').fill(subjectPrefix);
    await this.page.heal.click(
      this.page.locator('#react-select-2-option-0'),
      'First suggested subject option in the subjects autocomplete dropdown',
    );
    await this.page.locator("label[for='hobbies-checkbox-1']").click();
  }

  async uploadFile(filePath: string) {
    await this.page.locator('#uploadPicture').setInputFiles(filePath);
  }

  async fillAddressAndSelectLocation(address: string) {
    await this.page.locator('#currentAddress').fill(address);
    await this.page.locator('#state').click();
    // healwright-demo: intentionally broken locator, reserved for the self-healing demo (README
    // "Self-Healing UI Locators"). agent-fixer: skip — do not propose a fix for this line.
    await this.page.heal.click(this.page.locator('#react-select-3-option-broken'), 'First suggested option in the state dropdown');
    await this.page.locator('#city').click();
    await this.page.heal.click(this.page.locator('#react-select-4-option-broken'), 'First suggested option in the city dropdown');
  }

  async clickSubmit() {
    const submitButton = this.page.locator('#submit');
    await submitButton.scrollIntoViewIfNeeded();
    await submitButton.click();
  }

}
