// Classifies each passed_with_recovery event (see classify.ts's summarizeRecoveries) into WHY the
// original locator broke — timing, a structural DOM change, or a dynamic/session-generated id —
// via ai-agents/personas/healing-classifier.md. summarizeRecoveries already answers WHAT changed
// (old selector -> new locator); this answers whether that change should ever touch source code
// (STRUCTURAL/DYNAMIC_ID -> locator-medic candidate) or must not (TIMING -> a waitFor/timeout fix
// instead, changing the selector would be the wrong fix for a real-but-unrelated slowness problem).

import * as fs from 'fs';
import * as path from 'path';
import { callGemini, ModelPair } from '../ai-agents/gemini-text';
import { extractJson } from '../ai-agents/json-response';
import { RecoverySummary } from './classify';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/healing-classifier.md');

export type HealingVerdict = 'STRUCTURAL' | 'TIMING' | 'DYNAMIC_ID';
export type HealingAction = 'PROPOSE_FIX' | 'INCREASE_TIMEOUT' | 'IGNORE_TEMPORARY_FLAKE';

export interface HealingClassification {
  verdict: HealingVerdict;
  reason: string;
  action: HealingAction;
}

const MODELS: ModelPair = { primary: process.env.AI_MODEL ?? 'gemini-3.6-flash', fallback: process.env.AI_MODEL_FALLBACK, logTag: '[healing-classifier]' };

export function isHealingClassification(value: unknown): value is HealingClassification {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.verdict === 'STRUCTURAL' || v.verdict === 'TIMING' || v.verdict === 'DYNAMIC_ID') &&
    typeof v.reason === 'string' &&
    (v.action === 'PROPOSE_FIX' || v.action === 'INCREASE_TIMEOUT' || v.action === 'IGNORE_TEMPORARY_FLAKE')
  );
}

// One recovery may carry several recoveredSelectors/healedLocators (a step can recover more than
// one broken locator) — classified per RecoverySummary as a whole, since the persona's own input
// contract (original locator + failure log + healed locator) is naturally one-per-call and this
// project already has no case of a single step mixing a timing issue with a structural one.
export async function classifyRecovery(recovery: RecoverySummary): Promise<HealingClassification> {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');

  const originalLocator = recovery.recoveredSelectors.join(', ') || '(not recorded)';
  const failureLog = recovery.healedLocators.map((h) => h.why).filter(Boolean).join('\n') || '(no failure detail recorded)';
  const healedLocator = recovery.healedLocators.map((h) => h.newLocator).join(', ') || '(not recorded)';

  const prompt = [
    persona,
    '',
    '---',
    '',
    '## Task',
    '',
    `Test: ${recovery.testTitlePath.trim()}`,
    `Step: ${recovery.stepTitle}`,
    '',
    `1. Original locator: \`${originalLocator}\``,
    `2. Failure log: ${failureLog}`,
    `3. Healed locator: \`${healedLocator}\``,
  ].join('\n');

  const text = await callGemini(prompt, MODELS);
  const parsed = extractJson(text);

  if (!isHealingClassification(parsed)) {
    throw new Error(`healing-classifier returned an unexpected shape: ${text}`);
  }

  return parsed;
}
