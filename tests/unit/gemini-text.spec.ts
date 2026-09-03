// Unit coverage for gemini-text.ts's callerFrom — the attribution key recordAiUsage's caller field
// is derived from. logTag's own JSDoc says it's "prefixes stderr fallback/failure logs, e.g.
// '[jira-triage]'" (bracketed); nothing enforces that shape, so a future ModelPair passing an
// unbracketed or missing logTag would silently misattribute AI spend to 'ai-agents' in the cost
// report instead of the actual caller — this guards that the derivation stays predictable.
import { test, expect } from '@playwright/test';
import { callerFrom, ModelPair } from '../../src/ai-agents/gemini-text';

test.describe('callerFrom', () => {
  test('strips the brackets from a well-formed logTag', () => {
    const pair: ModelPair = { primary: 'gemini-3.6-flash', logTag: '[jira-triage]' };
    expect(callerFrom(pair)).toBe('jira-triage');
  });

  test('defaults to "ai-agents" when logTag is not set', () => {
    const pair: ModelPair = { primary: 'gemini-3.6-flash' };
    expect(callerFrom(pair)).toBe('ai-agents');
  });

  test('passes an unbracketed logTag through unchanged rather than mangling it', () => {
    const pair: ModelPair = { primary: 'gemini-3.6-flash', logTag: 'qa-analyst' };
    expect(callerFrom(pair)).toBe('qa-analyst');
  });
});
