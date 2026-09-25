import { test } from '../../src/ui/fixtures';
import * as path from 'path';
import { ForumSteps } from '../../src/ui/steps/forum.steps';

test.describe('DemoQA UI @ Automation practice form', () => {
  test('Fills the student registration form, uploads a file, picks a date, selects dropdown values, submits and verifies the success modal', async ({
    page,
  }) => {
    const steps = new ForumSteps(page);
    const uploadFile = path.resolve(__dirname, '../../resources/files/upload-test.txt');

    await steps.openPracticeForm();
    await steps.fillPersonalDetails('John', 'Doe', 'john.doe@example.com', '1234567890');
    await steps.pickDateOfBirth();
    await steps.fillSubjectsAndHobbies();
    await steps.uploadPicture(uploadFile);
    await steps.fillAddressAndLocation();
    await steps.submitForm();
    await steps.verifySuccessModal();
  });
});
