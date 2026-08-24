import { test, expect } from '@playwright/test';
import { config } from '../../src/core/config';

test.describe('Restful Booker API @ Negative & edge cases (generated)', () => {
  test('PATCH /booking/{id} with no auth Cookie on a non-existent id should return 403 Forbidden', async ({
    request,
  }) => {
    const response = await request.patch(`${config.host}/booking/999999999`, {
      data: { firstname: 'Ghost' },
    });

    expect(response.status()).toBe(403);
  });
});
