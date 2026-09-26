import { test, expect } from '@playwright/test';
import { requestedProjects } from '../../src/core/global-setup';

test.describe('requestedProjects', () => {
  test('returns undefined (no filter) when no --project flag is present', () => {
    expect(requestedProjects(['node', 'playwright', 'test'])).toBeUndefined();
  });

  test('returns the single project from one --project flag', () => {
    expect(requestedProjects(['node', 'playwright', 'test', '--project=api'])).toEqual(['api']);
  });

  test('collects every --project flag, not just the first — regression.yml passes several at once', () => {
    const argv = ['node', 'playwright', 'test', '--project=api', '--project=graphql', '--project=ui', '--shard=1/2'];
    expect(requestedProjects(argv)).toEqual(['api', 'graphql', 'ui']);
  });
});
