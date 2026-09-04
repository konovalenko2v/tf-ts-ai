// AI retry-budget verdict for a single failed test attempt, via ai-agents/personas/retry-dispatcher.md.
// Separate from classify.ts's groupFailures()/RETRY_VERDICTS (a static, rule-based table keyed on
// FailureCategory — config/ai-quota/ai-healing/assertion/other) — this is a per-failure AI call
// instead, with its own category set (adds INFRA_FLAKE, which the rule-based table has no
// equivalent for) and a numeric retryBudget rather than a fixed prose verdict.

import * as fs from 'fs';
import * as path from 'path';
import { callGemini, ModelPair } from '../ai-agents/gemini-text';
import { extractJson } from '../ai-agents/json-response';
import { TestSummaryEvent } from '../observability/types';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/retry-dispatcher.md');

export type RetryCategory = 'CONFIG_ERROR' | 'INFRA_FLAKE' | 'ASSERTION_FAILURE' | 'AI_QUOTA_EXHAUSTED';

export interface RetryVerdict {
  category: RetryCategory;
  shouldRetry: boolean;
  retryBudget: 0 | 1 | 2;
  explanation: string;
}

const MODELS: ModelPair = { primary: process.env.AI_MODEL ?? 'gemini-3.6-flash', fallback: process.env.AI_MODEL_FALLBACK, logTag: '[retry-dispatcher]' };

export function isRetryVerdict(value: unknown): value is RetryVerdict {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.category === 'CONFIG_ERROR' || v.category === 'INFRA_FLAKE' || v.category === 'ASSERTION_FAILURE' || v.category === 'AI_QUOTA_EXHAUSTED') &&
    typeof v.shouldRetry === 'boolean' &&
    (v.retryBudget === 0 || v.retryBudget === 1 || v.retryBudget === 2) &&
    typeof v.explanation === 'string'
  );
}

// Takes the first-attempt TestSummaryEvent (retry: 0) — the persona is explicit that it decides
// on the FIRST attempt's failure, not a later retry's.
export async function dispatchRetry(test: TestSummaryEvent): Promise<RetryVerdict> {
  if (!test.error) {
    throw new Error(`dispatchRetry called on a test with no error: ${test.testTitlePath}`);
  }

  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');

  const prompt = [
    persona,
    '',
    '---',
    '',
    '## Task',
    '',
    `Test: ${test.testTitlePath.trim()}`,
    `Project: ${test.project}`,
    `Status: ${test.status}`,
    '',
    'Error message:',
    '```',
    test.error.message,
    '```',
    ...(test.error.snippet ? ['', 'Snippet:', '```', test.error.snippet, '```'] : []),
  ].join('\n');

  const text = await callGemini(prompt, MODELS);
  const parsed = extractJson(text);

  if (!isRetryVerdict(parsed)) {
    throw new Error(`retry-dispatcher returned an unexpected shape: ${text}`);
  }

  return parsed;
}
