import { test, expect } from '@playwright/test';
import { AuthSteps } from '../../src/api/steps/auth.steps';
import { getValidUserName, getValidUserPassword } from '../../src/core/config';

test.describe('Restful Booker API @ Auth', () => {
  test('POST /auth with invalid credentials: status stays 200, body contains reason: Bad credentials', async ({ request }) => {
    const authSteps = new AuthSteps(request);
    const response = await authSteps.sendAuthRequest(getValidUserName(), 'wrong-password');

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.reason).toBe('Bad credentials');
  });

  test('POST /auth with an unknown username: status stays 200, body contains reason: Bad credentials', async ({ request }) => {
    const authSteps = new AuthSteps(request);
    const response = await authSteps.sendAuthRequest('unknown-user', getValidUserPassword());

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.reason).toBe('Bad credentials');
  });

  test('POST /auth with empty username/password: status stays 200, body contains reason', async ({ request }) => {
    const authSteps = new AuthSteps(request);
    const response = await authSteps.sendAuthRequest('', '');

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.reason).toBe('Bad credentials');
  });

  test('GET /ping should return 201 Created', async ({ request }) => {
    const authSteps = new AuthSteps(request);
    const response = await authSteps.ping();

    expect(response.status()).toBe(201);
  });
});
