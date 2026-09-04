// qa-analyst: reads a requirement (a text file — a pasted Jira ticket, a spec doc, or a diff) and
// produces a scenario checklist under the qa-analyst persona (ai-agents/personas/qa-analyst.md).
// Standalone entry point — not wired into CI, since a requirement has no fixed source location the
// way an observability run file does; invoked manually with a path to whatever the requirement is.
//
// Output is markdown only — this never writes test code or touches git. Feed its output as the
// edge-case brief for a manual test-developer/proposeTest() call.

import * as fs from 'fs';
import * as path from 'path';
import { callGemini } from './gemini-text';

const PERSONA_FILE = path.join(__dirname, '../../ai-agents/personas/qa-analyst.md');
const REPO_ROOT = path.join(__dirname, '../..');

// The persona's "Already covered" section is worthless if it names a file that doesn't exist —
// the model has no way to know the real spec inventory without being told, and will otherwise
// confabulate a plausible-sounding filename instead of citing a real one. List every existing
// spec file's path plus its test/describe titles so "already covered" claims are grounded.
function listExistingSpecs(): string {
  const specs: string[] = [];
  for (const dir of ['tests/api', 'tests/graphql', 'tests/ui']) {
    const full = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith('.spec.ts')) continue;
      const relPath = `${dir}/${file}`;
      const source = fs.readFileSync(path.join(full, file), 'utf-8');
      const describeMatch = source.match(/test\.describe\(\s*['"`](.+?)['"`]/);
      const titles = [...source.matchAll(/(?<!\.)\btest\(\s*['"`](.+?)['"`]/g)].map((m) => m[1]);
      specs.push([`${relPath}${describeMatch ? ` (${describeMatch[1]})` : ''}`, ...titles.map((t) => `  - ${t}`)].join('\n'));
    }
  }
  return specs.join('\n');
}

export async function analyze(requirementText: string): Promise<string> {
  const persona = fs.readFileSync(PERSONA_FILE, 'utf-8');
  const prompt = [
    persona,
    '',
    '---',
    '',
    '## Existing spec files (the ONLY files you may cite under "Already covered")',
    '',
    listExistingSpecs(),
    '',
    '## Requirement',
    '',
    requirementText,
  ].join('\n');
  return callGemini(prompt, {
    primary: process.env.AI_MODEL ?? 'gemini-3.6-flash',
    fallback: process.env.AI_MODEL_FALLBACK,
    logTag: '[qa-analyst]',
  });
}

async function main(): Promise<void> {
  const requirementFile = process.argv[2];
  if (!requirementFile) {
    process.stderr.write('[qa-analyst] usage: npm run qa-analyst -- <path-to-requirement-file>\n');
    process.exitCode = 1;
    return;
  }

  const requirementText = fs.readFileSync(requirementFile, 'utf-8');
  const checklist = await analyze(requirementText);
  process.stdout.write(checklist + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[qa-analyst] failed: ${err.message}\n`);
    process.exitCode = 1;
  });
}
