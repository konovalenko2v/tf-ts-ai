import { APIRequestContext } from '@playwright/test';
import { config } from '../../core/config';

export class AuthClient {
  constructor(private readonly request: APIRequestContext) {}

  async authenticate(username: string, password: string) {
    return this.request.post(`${config.host}/auth`, {
      data: { username, password },
    });
  }

  async ping() {
    return this.request.get(`${config.host}/ping`);
  }
}
