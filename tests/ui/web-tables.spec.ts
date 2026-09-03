import { test } from '../../src/ui/fixtures';
import { WebTablesSteps } from '../../src/ui/steps/web-tables.steps';

test.describe('DemoQA UI @ Web Tables', () => {
  test('Adds a new record and it appears in the table', async ({ page }) => {
    const steps = new WebTablesSteps(page);
    const record = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada.lovelace@example.com', age: '30', salary: '50000', department: 'Engineering' };

    await steps.openWebTablesPage();
    await steps.openAddModal();
    await steps.fillForm(record);
    await steps.submitForm();
    await steps.verifyModalClosed();
    await steps.verifyRowContains(record);
  });

  test('Rejects an empty form submit and marks every required field invalid', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.openAddModal();
    await steps.submitForm();
    await steps.verifyModalStillOpen();
    await steps.verifyFormMarkedInvalid();
    await steps.verifyFieldInvalid('firstName');
    await steps.verifyFieldInvalid('lastName');
    await steps.verifyFieldInvalid('userEmail');
    await steps.verifyFieldInvalid('age');
    await steps.verifyFieldInvalid('salary');
    await steps.verifyFieldInvalid('department');
  });

  test('Rejects a malformed email and keeps the modal open', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.openAddModal();
    await steps.fillForm({ firstName: 'Grace', lastName: 'Hopper', email: 'not-an-email', age: '40', salary: '60000', department: 'Navy' });
    await steps.submitForm();
    await steps.verifyModalStillOpen();
    await steps.verifyFieldInvalid('userEmail');
  });

  test('Rejects a non-numeric age (pattern="\\d*") and keeps the modal open', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.openAddModal();
    await steps.fillForm({ firstName: 'Alan', lastName: 'Turing', email: 'alan.turing@example.com', age: 'abc', salary: '70000', department: 'Cryptography' });
    await steps.submitForm();
    await steps.verifyModalStillOpen();
    await steps.verifyFieldInvalid('age');
  });

  test('Allows adding a record with an email that already exists — no uniqueness is enforced', async ({ page }) => {
    const steps = new WebTablesSteps(page);
    const duplicate = { firstName: 'Second', lastName: 'Cierra', email: 'cierra@example.com', age: '22', salary: '1000', department: 'X' };

    await steps.openWebTablesPage();
    await steps.openAddModal();
    await steps.fillForm(duplicate);
    await steps.submitForm();
    await steps.verifyModalClosed();
    // Two rows now share the same email — the row-count check is the meaningful assertion here,
    // since rowIdByEmail() would only ever find the first match and can't distinguish the two.
    await steps.verifyRowCount(4);
  });

  test('Edits an existing record and the table reflects the new values', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    const recordId = await steps.findRecordIdByEmail('alden@example.com');
    await steps.openEditModalFor(recordId);
    await steps.verifyFieldPrefilled('firstName', 'Alden');
    await steps.fillForm({ salary: '99999', department: 'Executive' });
    await steps.submitForm();
    await steps.verifyModalClosed();
    await steps.verifyRowContains({
      firstName: 'Alden',
      lastName: 'Cantrell',
      email: 'alden@example.com',
      age: '45',
      salary: '99999',
      department: 'Executive',
    });
  });

  test('Deletes a record and it no longer appears in the table', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.verifyRowCount(3);
    const recordId = await steps.findRecordIdByEmail('kierra@example.com');
    await steps.deleteRecord(recordId);
    await steps.verifyRowCount(2);
    await steps.verifyRowAbsentByEmail('kierra@example.com');
  });

  test('Search narrows the table to only matching rows', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.search('Cierra');
    await steps.verifySearchResultsContainOnly('cierra@example.com');
  });

  test('Search with no match empties the table entirely, with no placeholder row', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.search('no-such-value-anywhere');
    await steps.verifyNoRowsRendered();
  });

  test('Clearing the search box restores every row', async ({ page }) => {
    const steps = new WebTablesSteps(page);

    await steps.openWebTablesPage();
    await steps.search('Cierra');
    await steps.verifySearchResultsContainOnly('cierra@example.com');
    await steps.search('');
    await steps.verifyRowCount(3);
  });
});
