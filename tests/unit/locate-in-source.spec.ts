import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { locateInSource, isSkipped } from '../../src/agent-fixer/locate-in-source';

test.describe('locateInSource', () => {
  test('resolves contextName for a Prettier-wrapped multi-line heal.click(...) call', () => {
    const source = ['await this.page.heal.click(', "  this.page.locator('#broken-selector'),", "  'Some context description',", ');'].join(
      '\n',
    );

    const found = locateInSource(source, new Map([['#broken-selector', 'test-1']]));

    expect(found).toEqual([{ selector: '#broken-selector', contextName: 'Some context description', lineIndex: 1, testId: 'test-1' }]);
  });

  test('resolves contextName for a same-line heal.click(...) call', () => {
    const source = "await this.page.heal.click(this.page.locator('#x'), 'ctx');";

    const found = locateInSource(source, new Map([['#x', 't1']]));

    expect(found).toEqual([{ selector: '#x', contextName: 'ctx', lineIndex: 0, testId: 't1' }]);
  });

  test('resolves contextName through a getter indirection (this.x -> get x() { return this.page.locator(...) })', () => {
    const source = [
      'class Page {',
      '  get stateOption() {',
      "    return this.page.locator('#state-option');",
      '  }',
      '',
      '  async pick() {',
      '    await this.page.heal.click(',
      '      this.stateOption,',
      "      'State dropdown first option',",
      '    );',
      '  }',
      '}',
    ].join('\n');

    const found = locateInSource(source, new Map([['#state-option', 't1']]));

    expect(found).toEqual([{ selector: '#state-option', contextName: 'State dropdown first option', lineIndex: 2, testId: 't1' }]);
  });

  test('against the real practice-form.page.ts: both live heal.click(...) call sites resolve (regression — used to silently resolve zero)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'pages', 'practice-form.page.ts'), 'utf-8');
    const broken = new Map([
      ['#react-select-2-option-0', 'test-1'],
      ['div[id^="react-select-"][id*="-option-0"]', 'test-2'],
    ]);

    const found = locateInSource(source, broken);

    expect(found).toHaveLength(2);
    expect(found[0].contextName).toBe('First suggested subject option in the subjects autocomplete dropdown');
    expect(found[1].contextName).toBe('First suggested option in the city dropdown');
  });

  test('skips a selector marked with the agent-fixer skip comment even when its context would otherwise resolve', () => {
    const source = [
      '// agent-fixer: skip — do not touch this one',
      "await this.page.heal.click(this.page.locator('#skipped'), 'ctx');",
    ].join('\n');

    const found = locateInSource(source, new Map([['#skipped', 't1']]));

    expect(found).toEqual([]);
  });

  test('returns nothing for a selector that is not present in the source at all', () => {
    const source = "await this.page.locator('#other').click();";

    const found = locateInSource(source, new Map([['#missing', 't1']]));

    expect(found).toEqual([]);
  });

  test('returns nothing when the selector is found but no context string follows within the scan window', () => {
    const source = [
      "const x = this.page.locator('#lonely');",
      'const y = 1;',
      'const z = 2;',
      'const w = 3;',
      'const v = 4;',
      'const u = 5;',
    ].join('\n');

    const found = locateInSource(source, new Map([['#lonely', 't1']]));

    expect(found).toEqual([]);
  });

  test("does not leak the NEXT statement's string into this selector's context (regression — matching before checking the stop condition used to do this)", () => {
    const source = ["const x = this.page.locator('#lonely');", "await this.page.locator('#next-thing').click();"].join('\n');

    const found = locateInSource(source, new Map([['#lonely', 't1']]));

    expect(found).toEqual([]);
  });

  test('resolves through the correct getter when a longer getter name shares the same prefix', () => {
    const source = [
      'class Page {',
      '  get stateOption() {',
      "    return this.page.locator('#state-option');",
      '  }',
      '',
      '  get stateOptionList() {',
      "    return this.page.locator('#state-option-list');",
      '  }',
      '',
      '  async pick() {',
      "    await this.page.heal.click(this.stateOptionList, 'wrong target if word boundary is missing');",
      '    await this.page.heal.click(',
      '      this.stateOption,',
      "      'correct target',",
      '    );',
      '  }',
      '}',
    ].join('\n');

    const found = locateInSource(source, new Map([['#state-option', 't1']]));

    expect(found).toEqual([{ selector: '#state-option', contextName: 'correct target', lineIndex: 2, testId: 't1' }]);
  });
});

test.describe('isSkipped', () => {
  test('true when the nearest non-blank line above carries the skip marker', () => {
    const lines = ['// agent-fixer: skip', 'code here'];
    expect(isSkipped(lines, 1)).toBe(true);
  });

  test('false when the nearest non-blank line above is a comment without the marker', () => {
    const lines = ['// unrelated comment', 'code here'];
    expect(isSkipped(lines, 1)).toBe(false);
  });

  test('false when the nearest non-blank line above is code, even if a marker sits further up', () => {
    const lines = ['// agent-fixer: skip', 'const a = 1;', 'code here'];
    expect(isSkipped(lines, 2)).toBe(false);
  });

  test('walks past blank lines to find the marker', () => {
    const lines = ['// agent-fixer: skip', '', '', 'code here'];
    expect(isSkipped(lines, 3)).toBe(true);
  });
});
