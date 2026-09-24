import { test, expect } from '../../src/api/fixtures';
import { getValidUserName, getValidUserPassword } from '../../src/core/config';
import { parseBody } from '../../src/api/contract';
import { AuthResponseSchema } from '../../src/api/schemas/booking.schema';

test.describe('Restful Booker API @ Auth', () => {
  test('POST /auth with invalid credentials: status stays 200, body contains reason: Bad credentials', async ({ authSteps }) => {
    const response = await authSteps.sendAuthRequest(getValidUserName(), 'wrong-password');

    expect(response.status()).toBe(200);
    const body = await parseBody(response, AuthResponseSchema);
    expect(body.reason).toBe('Bad credentials');
  });

  test('POST /auth with an unknown username: status stays 200, body contains reason: Bad credentials', async ({ authSteps }) => {
    const response = await authSteps.sendAuthRequest('unknown-user', getValidUserPassword());

    expect(response.status()).toBe(200);
    const body = await parseBody(response, AuthResponseSchema);
    expect(body.reason).toBe('Bad credentials');
  });

  test('POST /auth with empty username/password: status stays 200, body contains reason', async ({ authSteps }) => {
    const response = await authSteps.sendAuthRequest('', '');

    expect(response.status()).toBe(200);
    const body = await parseBody(response, AuthResponseSchema);
    expect(body.reason).toBe('Bad credentials');
  });

  test('GET /ping should return 201 Created', async ({ authSteps }) => {
    const response = await authSteps.ping();

    expect(response.status()).toBe(201);
  });
});
