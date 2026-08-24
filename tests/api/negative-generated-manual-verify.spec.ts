import { test, expect } from '@playwright/test';
import { config } from '../../src/core/config';

test.describe('Restful Booker API @ Negative & edge cases - Generated (manual PR-logic verification)', () => {
  test('GET /booking/{id} with a non-numeric id returns a client error instead of 200', async ({ request }) => {
    const response = await request.get(`${config.host}/booking/not-a-number`);
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
