import { test, expect } from '@playwright/test';
import { config } from '../../src/core/config';

test.describe('Restful Booker API @ Negative & edge cases (generated)', () => {
  test('GET /booking/{id} with an extremely large numeric id (beyond safe integer range) should return 404', async ({ request }) => {
    const response = await request.get(`${config.host}/booking/999999999999999999999`);
    expect(response.status()).toBe(404);
  });
});
