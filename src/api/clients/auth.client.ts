import { APIRequestContext } from '@playwright/test';

export class AuthClient {
  constructor(private readonly request: APIRequestContext) {}

  async authenticate(username: string, password: string) {
    return this.request.post('auth', {
      data: { username, password },
    });
  }

  async ping() {
    return this.request.get('ping');
  }
}
