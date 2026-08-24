import { test } from '../../src/ui/fixtures';
import { TextBoxSteps } from '../../src/ui/steps/text-box.steps';

test.describe('DemoQA UI @ Text Box', () => {
  test('Fills all fields and verifies each is echoed back in the output block', async ({ page }) => {
    const steps = new TextBoxSteps(page);
    const fields = {
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      currentAddress: '123 Main Street, Springfield',
      permanentAddress: '456 Second Avenue, Shelbyville',
    };

    await steps.openTextBoxPage();
    await steps.fillForm(fields);
    await steps.submitForm();
    await steps.verifyOutput(fields);
  });

  test('Rejects an invalid email and renders no output', async ({ page }) => {
    const steps = new TextBoxSteps(page);

    await steps.openTextBoxPage();
    await steps.fillForm({ name: 'Jane Smith', email: 'not-an-email' });
    await steps.submitForm();
    await steps.verifyEmailRejected();
  });

  test('Submitting an empty form renders no output block', async ({ page }) => {
    const steps = new TextBoxSteps(page);

    await steps.openTextBoxPage();
    await steps.submitForm();
    await steps.verifyNoOutputRendered();
  });

  test('Submits with only the name filled in and echoes back just that field', async ({ page }) => {
    const steps = new TextBoxSteps(page);
    const fields = { name: 'Jane Smith' };

    await steps.openTextBoxPage();
    await steps.fillForm(fields);
    await steps.submitForm();
    await steps.verifyOutput(fields);
  });
});
