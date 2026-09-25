import { test } from '../../src/ui/fixtures';
// demo-pause: only needed by the commented-out test below — see its own comment.
// import * as path from 'path';
// import { ForumSteps } from '../../src/ui/steps/forum.steps';

test.describe('DemoQA UI @ Automation practice form', () => {
  // demo-pause: commented out, not skipped, so it stops matching testMatch entirely and can't
  // block a PR's required `test` check on the Gemini free-tier quota that practice-form.page.ts's
  // intentionally-broken #react-select-3-option-broken locator (line ~51, "healwright-demo")
  // depends on to self-heal. Uncomment when demoing self-healing — say something like "демо" to
  // have this put back.
  // test('Fills the student registration form, uploads a file, picks a date, selects dropdown values, submits and verifies the success modal', async ({
  //   page,
  // }) => {
  //   const steps = new ForumSteps(page);
  //   const uploadFile = path.resolve(__dirname, '../../resources/files/upload-test.txt');
  //
  //   await steps.openPracticeForm();
  //   await steps.fillPersonalDetails('John', 'Doe', 'john.doe@example.com', '1234567890');
  //   await steps.pickDateOfBirth();
  //   await steps.fillSubjectsAndHobbies();
  //   await steps.uploadPicture(uploadFile);
  //   await steps.fillAddressAndLocation();
  //   await steps.submitForm();
  //   await steps.verifySuccessModal();
  // });
});
