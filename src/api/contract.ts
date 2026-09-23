import type { APIResponse } from '@playwright/test';
import { z } from 'zod';

// Stable prefix, matched by failure-analysis/classify.ts to put these failures in their own
// `contract` category — a changed response shape fails identically on every retry, and without its
// own category it would land in `other` and cost a paid retry-dispatcher call per run.
export const CONTRACT_VIOLATION_PREFIX = 'Contract violation';

export class ContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

// The single place a response body becomes typed data. Replaces `await response.json()`, which
// returns `any`: an API that renames or retypes a field would otherwise flow silently into the test
// as `undefined`, and only fail — if at all — on whichever assertion happened to touch that field.
//
// Call this on success paths only. Restful Booker's 4xx bodies are plain text ("Forbidden",
// "Not Found"), not JSON, so there is no contract to check there — assert on the status instead.
export async function parseBody<S extends z.ZodType>(response: APIResponse, schema: S): Promise<z.infer<S>> {
  const body: unknown = await response.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    const name = schema.description ?? 'the expected schema';
    throw new ContractViolationError(
      `${CONTRACT_VIOLATION_PREFIX}: ${response.url()} (HTTP ${response.status()}) does not match ${name}\n` +
        z.prettifyError(result.error),
    );
  }
  return result.data;
}
