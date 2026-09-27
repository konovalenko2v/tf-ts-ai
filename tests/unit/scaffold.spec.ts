import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { test, expect } from '@playwright/test';
import {
  configKeyFor,
  renderGoalFileTemplate,
  renderSpecFileTemplate,
  ORACLE_NOT_WRITTEN_MARKER,
  scaffold,
} from '../../src/goal-evolution/scaffold';

test.describe('configKeyFor', () => {
  test('follows the existing buttonsHost/textBoxHost naming convention', () => {
    expect(configKeyFor('alerts-confirm')).toBe('alertsConfirmHost');
    expect(configKeyFor('buttons')).toBe('buttonsHost');
    expect(configKeyFor('a-b-c')).toBe('aBCHost');
  });
});

test.describe('renderGoalFileTemplate', () => {
  test('the scaffolded succeedsWhen contains the oracle-not-written marker', () => {
    const source = renderGoalFileTemplate(
      'demo-goal',
      'demoGoalHost',
      'do the thing',
      'page-knowledge/demo-goal.md',
      'src/ui/pages/demo-goal.page.ts',
    );
    expect(source).toContain(ORACLE_NOT_WRITTEN_MARKER);
    // The marker must be reachable via succeedsWhen.toString() at runtime (run.ts's guard reads
    // the function source, not the file source) — so it must survive being inside the function body.
    expect(source).toMatch(/succeedsWhen: async \(\) => \{[\s\S]*ORACLE_NOT_WRITTEN[\s\S]*\}/);
  });

  test('never contains an expect(...) call — a scaffolded goal must not accidentally satisfy the driver contract check itself', () => {
    const source = renderGoalFileTemplate(
      'demo-goal',
      'demoGoalHost',
      'do the thing',
      'page-knowledge/demo-goal.md',
      'src/ui/pages/demo-goal.page.ts',
    );
    expect(source).not.toMatch(/\bexpect\s*\(/);
  });

  test('description is prefixed with the config-resolved URL, not a literal domain', () => {
    const source = renderGoalFileTemplate(
      'demo-goal',
      'demoGoalHost',
      'click the thing',
      'page-knowledge/demo-goal.md',
      'src/ui/pages/demo-goal.page.ts',
    );
    expect(source).toContain('config.demoGoalHost');
    expect(source).not.toContain('demoqa.com');
  });
});

test.describe('renderSpecFileTemplate', () => {
  test('imports achieve from the driver path and calls succeedsWhen after achieve', () => {
    const source = renderSpecFileTemplate('demo-goal', 'demoGoalHost', 'demoGoalGoal');
    expect(source).toContain("import { achieve } from '../../../src/ui/pages/demo-goal.page';");
    expect(source).toContain('await achieve(page);');
    expect(source).toContain('await demoGoalGoal.succeedsWhen(page);');
    // achieve must be awaited strictly before succeedsWhen, not the other way around.
    expect(source.indexOf('await achieve(page)')).toBeLessThan(source.indexOf('succeedsWhen(page)'));
  });
});

function withTempRepoRoot(): { dir: string; restore: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-refuse-'));
  return { dir, restore: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test.describe('scaffold — refuses to overwrite existing files', () => {
  test('rejects an id whose goal file already exists', async () => {
    const { dir, restore } = withTempRepoRoot();
    try {
      // scaffold() resolves paths from its own module location (REPO_ROOT), not an injectable
      // root, so this test targets the REAL repo's goals directory with a throwaway id guaranteed
      // not to collide with a real goal, rather than faking REPO_ROOT — verifies the actual guard
      // that ships, not a reimplementation of it.
      const throwawayId = `scaffold-refuse-test-${path.basename(dir).toLowerCase()}`;
      const goalFile = path.join(__dirname, '../../src/goal-evolution/goals', `${throwawayId}.ts`);
      fs.writeFileSync(goalFile, '// pre-existing stub for the refusal test\n');
      try {
        await expect(scaffold({ id: throwawayId, urlPath: '/whatever', description: 'irrelevant' })).rejects.toThrow(/already exists/);
      } finally {
        fs.rmSync(goalFile, { force: true });
      }
    } finally {
      restore();
    }
  });

  test('rejects a non-kebab-case id before touching any file', async () => {
    await expect(scaffold({ id: 'NotKebabCase', urlPath: '/whatever', description: 'irrelevant' })).rejects.toThrow(/kebab-case/);
  });

  test('rejects a urlPath that is not repo-relative (looks like a full URL)', async () => {
    await expect(
      scaffold({ id: 'scaffold-url-guard-test', urlPath: 'https://evil.example.com/alerts', description: 'irrelevant' }),
    ).rejects.toThrow(/must start with/);
  });
});
