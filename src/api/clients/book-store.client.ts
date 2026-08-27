import { APIRequestContext } from '@playwright/test';
import { config } from '../../core/config';

const ACCOUNT_PATH = '/Account/v1';

export class BookStoreClient {
  constructor(private readonly request: APIRequestContext) {}

  async createUser(userName: string, password: string) {
    return this.request.post(`${config.bookStoreHost}${ACCOUNT_PATH}/User`, {
      data: { userName, password },
    });
  }

  async generateToken(userName: string, password: string) {
    return this.request.post(`${config.bookStoreHost}${ACCOUNT_PATH}/GenerateToken`, {
      data: { userName, password },
    });
  }

  async getUser(userId: string, token: string) {
    return this.request.get(`${config.bookStoreHost}${ACCOUNT_PATH}/User/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

export async function achieve(
  request: APIRequestContext,
  userName: string,
  password: string
): Promise<string | undefined> {
  const client = new BookStoreClient(request);
  const response = await client.createUser(userName, password);
  if (response.status() !== 201) {
    return undefined;
  }
  const body = await response.json();
  return body.userID;
}
