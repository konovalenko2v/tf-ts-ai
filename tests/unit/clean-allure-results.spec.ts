import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { test, expect } from '@playwright/test';
import cleanAllureResults from '../../src/core/clean-allure-results';

function withTempCwd(): { dir: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-allure-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  return { dir, restore: () => process.chdir(originalCwd) };
}

test.describe('cleanAllureResults', () => {
  test('does nothing when allure-results does not exist', async () => {
    const { restore } = withTempCwd();
    try {
      await expect(cleanAllureResults()).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });

  test('removes result files but keeps the history subdirectory', async () => {
    const { dir, restore } = withTempCwd();
    try {
      fs.mkdirSync('allure-results/history', { recursive: true });
      fs.writeFileSync('allure-results/history/history-trend.json', '[]');
      fs.writeFileSync('allure-results/some-test-result.json', '{}');
      fs.writeFileSync('allure-results/some-container.json', '{}');

      await cleanAllureResults();

      expect(fs.readdirSync('allure-results')).toEqual(['history']);
      expect(fs.readFileSync('allure-results/history/history-trend.json', 'utf-8')).toBe('[]');
    } finally {
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
