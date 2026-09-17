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
    await steps.fillAddress();
    // The state/city dropdown needs a self-healing provider (see practice-form.page.ts's
    // selectStateAndCity — the state locator is deliberately broken, README's "Self-Healing UI
    // Locators"). claude-only-edition's CI runs with SELF_HEAL=0 (no key for a cloud provider, no
    // network path from the runner to a developer's local Ollama), so only this one step is
    // skipped there — verified locally against qwen3:14b: cache cleared, real Ollama call, correct
    // new strategy in ~37s.
    if (process.env.SELF_HEAL === '1') {
      await steps.selectStateAndCity();
    }
    await steps.submitForm();
    await steps.verifySuccessModal();
  });
});
