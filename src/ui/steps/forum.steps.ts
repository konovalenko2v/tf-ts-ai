import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { PracticeFormPage } from '../pages/practice-form.page';

export class ForumSteps {
  readonly formPage: PracticeFormPage;

  constructor(page: HealPage) {
    this.formPage = new PracticeFormPage(page);
  }

  async openPracticeForm() {
    await test.step('Open the automation practice form page', async () => this.formPage.navigate());
  }

  async fillPersonalDetails(firstName: string, lastName: string, email: string, phone: string) {
    await test.step('Fill personal details: name, email, gender, phone', async () =>
      this.formPage.fillMainPersonalDetails(firstName, lastName, email, phone));
  }

  async pickDateOfBirth() {
    await test.step('Pick date of birth from the date picker', async () =>
      this.formPage.selectDateOfBirth('6', '1990'));
  }

  async fillSubjectsAndHobbies() {
    await test.step('Fill subjects and select a hobby', async () => this.formPage.addSubjectAndHobby('Maths'));
  }

  async uploadPicture(filePath: string) {
    await test.step('Upload a picture file', async () => this.formPage.uploadFile(filePath));
  }

  async fillAddressAndLocation() {
    await test.step('Fill current address and select state/city', async () =>
      this.formPage.fillAddressAndSelectLocation('123 Main Street, Springfield'));
  }

  async submitForm() {
    await test.step('Submit the form', async () => this.formPage.clickSubmit());
  }

  async verifySuccessModal() {
    await test.step('Verify the success modal is shown', async () => {
      await expect(this.formPage.modalTitle).toBeVisible();
      await expect(this.formPage.modalTitle).toHaveText('Thanks for submitting the form');
    });
  }
}
