// Unit coverage for the shared AI-JSON unwrapper. Every JSON-STRICT persona asks the model for a
// bare JSON object and gets a ```json fence (or a lead-in sentence) anyway — these are the shapes
// that have to keep parsing, since a regression here breaks every JSON-verdict caller at once.
import { test, expect } from '@playwright/test';
import { extractJson } from '../../src/ai-agents/json-response';

test.describe('extractJson', () => {
  test('parses raw JSON with no fence', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  test('parses raw JSON with surrounding whitespace', () => {
    expect(extractJson('  \n {"a":1}\n  ')).toEqual({ a: 1 });
  });

  test('strips a ```json fence before parsing', () => {
    expect(extractJson('```json\n{"verdict":"TIMING"}\n```')).toEqual({ verdict: 'TIMING' });
  });

  test('strips a fence that has prose around it', () => {
    const text = 'Here is my answer:\n```json\n{"verdict":"STRUCTURAL"}\n```\nLet me know if needed.';
    expect(extractJson(text)).toEqual({ verdict: 'STRUCTURAL' });
  });

  test('matches the fence case-insensitively (```JSON)', () => {
    expect(extractJson('```JSON\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('throws on a reply that contains no JSON at all — never returns a partial/empty object', () => {
    expect(() => extractJson('I cannot answer that.')).toThrow();
  });
});
