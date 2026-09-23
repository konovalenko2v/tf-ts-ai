import { APIRequestContext } from '@playwright/test';
import { AuthClient } from '../clients/auth.client';
import { getValidUserName, getValidUserPassword } from '../../core/config';
import { parseBody } from '../contract';
import { AuthResponseSchema } from '../schemas/booking.schema';

let cachedToken: string | null = null;

export async function getAuthToken(request: APIRequestContext): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }
  const authClient = new AuthClient(request);
  const response = await authClient.authenticate(getValidUserName(), getValidUserPassword());
  if (response.status() !== 200) {
    throw new Error(`Auth request failed with status ${response.status()}`);
  }
  const body = await parseBody(response, AuthResponseSchema);
  if (!body.token) {
    throw new Error(`Auth response did not contain a token: ${JSON.stringify(body)}`);
  }
  cachedToken = body.token;
  return cachedToken;
}
