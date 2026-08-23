import { test, expect } from '@playwright/test';
import { GraphQlClient } from '../../src/graphql/client';
import { readQuery } from '../../src/core/file-util';

test.describe('Hygraph GraphQL API @ Positive queries', () => {
  const LIST = readQuery('QueryListWithPaginationAndLimit.json');
  const FIRST_PRODUCT_ID = readQuery('QueryFirstProductId.json');
  const SINGLE_ENTITY_BY_ID = readQuery('QuerySingleEntityById.json');
  const USING_GRAPHQL_VARIABLES = readQuery('QueryUsingGraphQlVariables.json');
  const WITH_NESTED_FIELDS_ACROSS_TYPES = readQuery('QueryWithNestedFieldsAcrossTypes.json');

  async function firstProductId(client: GraphQlClient): Promise<string> {
    const response = await client.execute(FIRST_PRODUCT_ID);
    const body = await response.json();
    return body.data.products[0].id;
  }

  test('A Relay-style connection query with pagination/limit returns pageInfo, edges and an aggregate count', async ({
    request,
  }) => {
    const client = new GraphQlClient(request);
    const response = await client.execute(LIST, { numPages: 2 });
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.data.productsConnection.edges).toHaveLength(2);
    expect(body.data.productsConnection.pageInfo.hasNextPage).toBe(true);
    expect(body.data.productsConnection.pageInfo.hasPreviousPage).toBe(false);
    expect(body.data.productsConnection.aggregate.count).toBeGreaterThan(2);
  });

  test("A query for a single entity by ID returns that entity's fields", async ({ request }) => {
    const client = new GraphQlClient(request);
    const productId = await firstProductId(client);

    const response = await client.execute(SINGLE_ENTITY_BY_ID, { id: productId });
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.data.product.id).toBe(productId);
    expect(body.data.product.name).toBeTruthy();
    expect(body.data.product.price).toBeGreaterThan(0);
  });

  test('A query using GraphQL variables (not string interpolation) returns the entity matching the variable', async ({
    request,
  }) => {
    const client = new GraphQlClient(request);
    const productId = await firstProductId(client);

    const response = await client.execute(USING_GRAPHQL_VARIABLES, { id: productId });
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.data.product.id).toBe(productId);
    expect(body.data.product.name).toBeTruthy();
  });

  test('A query with nested fields across types (product -> categories -> name) resolves the relation', async ({
    request,
  }) => {
    const client = new GraphQlClient(request);
    const productId = await firstProductId(client);

    const response = await client.execute(WITH_NESTED_FIELDS_ACROSS_TYPES, { id: productId });
    const body = await response.json();

    expect(response.status()).toBe(200);
    const names: string[] = body.data.product.categories.map((c: { name: string }) => c.name);
    expect(names.length).toBeGreaterThan(0);
    names.forEach((name) => expect(name).toBeTruthy());
  });
});
