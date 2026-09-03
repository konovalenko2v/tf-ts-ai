import { Locator } from '@playwright/test';
import { HealPage } from 'healwright';
import { config } from '../../core/config';

export interface RecordFields {
  firstName: string;
  lastName: string;
  email: string;
  age: string;
  salary: string;
  department: string;
}

export class WebTablesPage {
  readonly addButton: Locator;
  readonly searchBox: Locator;
  readonly table: Locator;
  readonly modal: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly ageInput: Locator;
  readonly salaryInput: Locator;
  readonly departmentInput: Locator;
  readonly submitButton: Locator;
  readonly form: Locator;

  constructor(private readonly page: HealPage) {
    this.addButton = page.locator('#addNewRecordButton');
    this.searchBox = page.locator('#searchBox');
    this.table = page.locator('table');
    this.modal = page.locator('.modal-content');
    this.firstNameInput = page.locator('#firstName');
    this.lastNameInput = page.locator('#lastName');
    this.emailInput = page.locator('#userEmail');
    this.ageInput = page.locator('#age');
    this.salaryInput = page.locator('#salary');
    this.departmentInput = page.locator('#department');
    this.submitButton = page.locator('#submit');
    this.form = page.locator('#userForm');
  }

  async navigate() {
    await this.page.route(/doubleclick|googlesyndication|adsbygoogle/, (route) => route.abort());
    await this.page.goto(config.webTablesHost);
  }

  async openAddModal() {
    await this.addButton.click();
  }

  // #edit-record-<id> — id is the record's stable app-assigned id, not its row position (see
  // docs/page-knowledge/web-tables.md) — callers pass whichever id they already know (e.g. from
  // rowIdByEmail below), never a row index.
  async openEditModal(recordId: string) {
    await this.page.locator(`#edit-record-${recordId}`).click();
  }

  async deleteRecord(recordId: string) {
    await this.page.locator(`#delete-record-${recordId}`).click();
  }

  async fillForm(fields: Partial<RecordFields>) {
    if (fields.firstName !== undefined) await this.firstNameInput.fill(fields.firstName);
    if (fields.lastName !== undefined) await this.lastNameInput.fill(fields.lastName);
    if (fields.email !== undefined) await this.emailInput.fill(fields.email);
    if (fields.age !== undefined) await this.ageInput.fill(fields.age);
    if (fields.salary !== undefined) await this.salaryInput.fill(fields.salary);
    if (fields.department !== undefined) await this.departmentInput.fill(fields.department);
  }

  async submit() {
    await this.submitButton.click();
  }

  row(index: number): Locator {
    return this.table.locator('tbody tr').nth(index);
  }

  rows(): Locator {
    return this.table.locator('tbody tr');
  }

  async rowCount(): Promise<number> {
    return this.rows().count();
  }

  // Scans currently-visible rows for one whose Email cell (4th <td>, 0-indexed column 3) matches,
  // then reads that row's edit-icon id — the only place the record's stable id is exposed in the
  // DOM. Returns undefined rather than throwing so a caller can assert "not found" as a real
  // outcome (e.g. after a delete) instead of catching a locator timeout.
  async rowIdByEmail(email: string): Promise<string | undefined> {
    const count = await this.rowCount();
    for (let i = 0; i < count; i++) {
      const emailCell = await this.row(i).locator('td').nth(3).textContent();
      if (emailCell?.trim() === email) {
        const editId = await this.row(i).locator('[id^="edit-record-"]').getAttribute('id');
        return editId?.replace('edit-record-', '');
      }
    }
    return undefined;
  }

  async search(query: string) {
    await this.searchBox.fill(query);
  }

  // Browser-native HTML5 validation (see docs/page-knowledge/web-tables.md) marks a rejected-submit
  // field with the :invalid pseudo-class — this reads it off the field's own locator rather than
  // exposing the raw `page` to steps, keeping HealPage encapsulated in the Page Object like every
  // other locator here.
  fieldInvalid(field: 'firstName' | 'lastName' | 'userEmail' | 'age' | 'salary' | 'department'): Locator {
    return this.page.locator(`#${field}:invalid`);
  }
}
