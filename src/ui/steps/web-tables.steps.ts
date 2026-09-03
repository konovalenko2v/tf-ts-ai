import { expect, test } from '../fixtures';
import { HealPage } from 'healwright';
import { RecordFields, WebTablesPage } from '../pages/web-tables.page';

export class WebTablesSteps {
  readonly webTablesPage: WebTablesPage;

  constructor(page: HealPage) {
    this.webTablesPage = new WebTablesPage(page);
  }

  async openWebTablesPage() {
    await test.step('Open the web tables page', async () => this.webTablesPage.navigate());
  }

  async openAddModal() {
    await test.step('Open the Add record modal', async () => this.webTablesPage.openAddModal());
  }

  async fillForm(fields: Partial<RecordFields>) {
    await test.step('Fill the registration form', async () => this.webTablesPage.fillForm(fields));
  }

  async submitForm() {
    await test.step('Submit the form', async () => this.webTablesPage.submit());
  }

  async verifyModalClosed() {
    await test.step('Verify the modal closed', async () => {
      await expect(this.webTablesPage.modal).toHaveCount(0);
    });
  }

  async verifyModalStillOpen() {
    await test.step('Verify the modal is still open (submit was rejected)', async () => {
      await expect(this.webTablesPage.modal).toHaveCount(1);
    });
  }

  async verifyFormMarkedInvalid() {
    await test.step('Verify the form is marked was-validated after a rejected submit', async () => {
      await expect(this.webTablesPage.form).toHaveClass(/was-validated/);
    });
  }

  async verifyFieldInvalid(field: 'firstName' | 'lastName' | 'userEmail' | 'age' | 'salary' | 'department') {
    await test.step(`Verify #${field} is marked :invalid`, async () => {
      await expect(this.webTablesPage.fieldInvalid(field)).toHaveCount(1);
    });
  }

  async verifyRowContains(fields: RecordFields) {
    await test.step(`Verify a row exists for ${fields.email}`, async () => {
      const recordId = await this.webTablesPage.rowIdByEmail(fields.email);
      expect(recordId, `expected to find a row with email ${fields.email}`).toBeDefined();
      const row = this.webTablesPage.row(await this.rowIndexOf(recordId!));
      await expect(row).toContainText(fields.firstName);
      await expect(row).toContainText(fields.lastName);
      await expect(row).toContainText(fields.age);
      await expect(row).toContainText(fields.salary);
      await expect(row).toContainText(fields.department);
    });
  }

  private async rowIndexOf(recordId: string): Promise<number> {
    const rows = this.webTablesPage.rows();
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const editId = await rows.nth(i).locator('[id^="edit-record-"]').getAttribute('id');
      if (editId === `edit-record-${recordId}`) return i;
    }
    throw new Error(`no row found for record id ${recordId}`);
  }

  async findRecordIdByEmail(email: string): Promise<string> {
    return await test.step(`Find the record id for ${email}`, async () => {
      const id = await this.webTablesPage.rowIdByEmail(email);
      expect(id, `expected an existing row with email ${email}`).toBeDefined();
      return id!;
    });
  }

  async openEditModalFor(recordId: string) {
    await test.step(`Open the Edit modal for record ${recordId}`, async () => this.webTablesPage.openEditModal(recordId));
  }

  async verifyFieldPrefilled(field: 'firstName' | 'lastName' | 'age' | 'salary' | 'department', expected: string) {
    await test.step(`Verify #${field} is pre-filled with "${expected}"`, async () => {
      const locatorMap = {
        firstName: this.webTablesPage.firstNameInput,
        lastName: this.webTablesPage.lastNameInput,
        age: this.webTablesPage.ageInput,
        salary: this.webTablesPage.salaryInput,
        department: this.webTablesPage.departmentInput,
      };
      await expect(locatorMap[field]).toHaveValue(expected);
    });
  }

  async deleteRecord(recordId: string) {
    await test.step(`Delete record ${recordId}`, async () => this.webTablesPage.deleteRecord(recordId));
  }

  async verifyRowCount(expected: number) {
    await test.step(`Verify the table has ${expected} row(s)`, async () => {
      await expect(this.webTablesPage.rows()).toHaveCount(expected);
    });
  }

  async verifyRowAbsentByEmail(email: string) {
    await test.step(`Verify no row exists for ${email}`, async () => {
      const id = await this.webTablesPage.rowIdByEmail(email);
      expect(id, `expected no row with email ${email}, but one was found`).toBeUndefined();
    });
  }

  async search(query: string) {
    await test.step(`Search for "${query}"`, async () => this.webTablesPage.search(query));
  }

  async verifySearchResultsContainOnly(email: string) {
    await test.step(`Verify search results contain only the row for ${email}`, async () => {
      await expect(this.webTablesPage.rows()).toHaveCount(1);
      await expect(this.webTablesPage.row(0)).toContainText(email);
    });
  }

  async verifyNoRowsRendered() {
    await test.step('Verify no rows are rendered for a non-matching search', async () => {
      await expect(this.webTablesPage.rows()).toHaveCount(0);
    });
  }
}
