// Combines a failing test's own data (the step that broke, its error message) with the Jira
// context collect-context.ts gathered, and asks the model for a single bug-vs-feature-change
// verdict. This is deliberately the only place that makes that call — collect-context.ts's two
// internal yes/no checks (thin-context, sibling-relevance) are about gathering the *right*
// context, not about judging the failure itself.

import { askYesNoWithReason, YesNoWithReason } from './gemini-verdict';
import { JiraContext } from './collect-context';

export interface FailingStep {
  testTitlePath: string;
  stepTitle: string;
  errorMessage: string;
}

export interface TriageVerdict extends YesNoWithReason {
  ticketKey: string;
}

function renderContext(context: JiraContext): string {
  const lines: string[] = [];

  lines.push(`Ticket ${context.ticket.key}: ${context.ticket.summary}`);
  lines.push(`Description: ${context.ticket.description || '(none)'}`);
  if (context.ticket.comments.length > 0) {
    lines.push('Comments:');
    context.ticket.comments.forEach((c) => lines.push(`- ${c}`));
  }

  if (context.parentStory) {
    lines.push('', `Parent Story ${context.parentStory.key}: ${context.parentStory.summary}`);
    lines.push(`Story description: ${context.parentStory.description || '(none)'}`);
    if (context.parentStory.siblings.length > 0) {
      lines.push('Related subtasks in the same Story:');
      for (const s of context.parentStory.siblings) {
        lines.push(`- ${s.key}: ${s.summary} — ${s.description || '(no description)'}`);
        if (s.comments && s.comments.length > 0) {
          s.comments.forEach((c) => lines.push(`    comment: ${c}`));
        }
      }
    }
  }

  return lines.join('\n');
}

export async function judgeFailure(step: FailingStep, context: JiraContext): Promise<TriageVerdict> {
  const prompt = [
    'A Playwright test step failed. Decide whether this is a real bug, or the expected result of',
    'an intentional feature change already described in the Jira context below.',
    '',
    `Test: ${step.testTitlePath}`,
    `Failing step: ${step.stepTitle}`,
    `Error: ${step.errorMessage}`,
    '',
    '--- Jira context ---',
    renderContext(context),
    '--- end Jira context ---',
    '',
    'Answer YES if the Jira context describes a change that would explain this specific failure',
    '(the old test step is now testing outdated behavior). Answer NO if nothing here explains it,',
    'or the ticket is unrelated — in which case this is most likely a real bug.',
  ].join('\n');

  const result = await askYesNoWithReason(prompt);
  return { ...result, ticketKey: context.ticket.key };
}
