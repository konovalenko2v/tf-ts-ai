import { test, expect } from '@playwright/test';
import { GraphQlClient } from '../../src/graphql/client';
import { readQuery } from '../../src/core/file-util';

test.describe('Hygraph GraphQL API @ Negative queries', () => {
  const NON_EXISTENT_ID = readQuery('QueryWithNonExistentId.json');
  const MALFORMED = readQuery('MalformedQuery.json');
  const NON_EXISTENT_FIELD = readQuery('QueryWithNonExistentField.json');

  test('A query for a non-existent ID returns HTTP 200 with data.product = null and no errors array', async ({ request }) => {
    const client = new GraphQlClient(request);
    const response = await client.execute(NON_EXISTENT_ID);
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.data.product).toBeNull();
    expect(body.errors).toBeUndefined();
  });

  test('A syntactically malformed query returns an errors[] array with a message and no data', async ({ request }) => {
    const client = new GraphQlClient(request);
    const response = await client.execute(MALFORMED);
    const body = await response.json();

    expect(response.status()).toBe(400);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0].message).toBeTruthy();
    expect(body.data).toBeNull();
  });

  test("Requesting a field that doesn't exist on the type returns a validation error and no data", async ({ request }) => {
    const client = new GraphQlClient(request);
    const response = await client.execute(NON_EXISTENT_FIELD);
    const body = await response.json();

    expect(response.status()).toBe(400);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0].message.toLowerCase()).toContain('thisfielddoesnotexist');
    expect(body.data).toBeNull();
  });
});
