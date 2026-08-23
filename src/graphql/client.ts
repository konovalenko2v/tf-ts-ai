import { APIRequestContext, test } from '@playwright/test';
import { config } from '../core/config';

export class GraphQlClient {
  constructor(private readonly request: APIRequestContext) {}

  async execute(query: string, variables?: Record<string, unknown>) {
    return test.step(`Execute GraphQL query${variables ? ` with variables ${JSON.stringify(variables)}` : ''}`, async () =>
      this.request.post(config.gqlHost, {
        data: { query, variables: variables ?? null },
      }));
  }
}
