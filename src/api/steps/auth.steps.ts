import { APIRequestContext, test } from '@playwright/test';
import { AuthClient } from '../clients/auth.client';

export class AuthSteps {
  private readonly authClient: AuthClient;

  constructor(request: APIRequestContext) {
    this.authClient = new AuthClient(request);
  }

  async ping() {
    return test.step('Ping api', async () => this.authClient.ping());
  }

  async sendAuthRequest(username: string, password: string) {
    return test.step(`Send POST /auth request with username=${username}, password=${password}`, async () =>
      this.authClient.authenticate(username, password));
  }
}
