import { getIssue, getSubtasks, adfToPlainText, commentsToPlainText, JiraIssue } from './jira-client';
import { askYesNo } from '../ai-agents/gemini-text';

export interface TicketContext {
  key: string;
  summary: string;
  description: string;
  comments: string[];
}

export interface SiblingContext {
  key: string;
  summary: string;
  description: string;
  comments?: string[];
}

export interface JiraContext {
  ticket: TicketContext;
  parentStory?: {
    key: string;
    summary: string;
    description: string;
    siblings: SiblingContext[];
  };
}

const JIRA_KEY_PATTERN = /[A-Z][A-Z0-9]*-\d+/;

export function parseTicketKey(branchName: string): string | null {
  const match = branchName.match(JIRA_KEY_PATTERN);
  return match ? match[0] : null;
}

function toTicketContext(issue: JiraIssue): TicketContext {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    description: adfToPlainText(issue.fields.description),
    comments: commentsToPlainText(issue),
  };
}

// Cheap heuristic before ever calling the model — a ticket with no description and no comments is
// unambiguously thin, no need to spend a call asking "is this enough?" when the answer is obvious.
function isObviouslyThin(ticket: TicketContext): boolean {
  return ticket.description.trim() === '' && ticket.comments.length === 0;
}

async function hasEnoughContext(ticket: TicketContext, failureArea: string): Promise<boolean> {
  if (isObviouslyThin(ticket)) return false;

  const prompt = [
    `A UI test covering "${failureArea}" is failing. Here is the Jira ticket for the branch it failed on:`,
    '',
    `Summary: ${ticket.summary}`,
    `Description: ${ticket.description || '(none)'}`,
    ticket.comments.length > 0 ? `Comments:\n${ticket.comments.map((c) => `- ${c}`).join('\n')}` : 'Comments: (none)',
    '',
    'Is there enough information here to judge whether the test failure is an intentional feature',
    'change described by this ticket, versus an unrelated bug?',
  ].join('\n');

  return askYesNo(prompt);
}

async function isSiblingRelevant(sibling: SiblingContext, failureArea: string): Promise<boolean> {
  const prompt = [
    `A UI test covering "${failureArea}" is failing. Does this Jira subtask look related to that`,
    'area (same page, component, or feature) — enough that its comments might explain the failure?',
    '',
    `Summary: ${sibling.summary}`,
    `Description: ${sibling.description || '(none)'}`,
  ].join('\n');

  return askYesNo(prompt);
}

export async function collectJiraContext(branchName: string, failureArea: string): Promise<JiraContext | null> {
  const key = parseTicketKey(branchName);
  if (!key) return null;

  const TICKET_FIELDS = ['summary', 'description', 'comment', 'parent'];
  const issue = await getIssue(key, TICKET_FIELDS);
  const ticket = toTicketContext(issue);

  const context: JiraContext = { ticket };

  const enough = await hasEnoughContext(ticket, failureArea);
  if (enough) return context;

  const parentKey = issue.fields.parent?.key;
  if (!parentKey) return context;

  const SUMMARY_FIELDS = ['summary', 'description'];
  const parentIssue = await getIssue(parentKey, SUMMARY_FIELDS);
  const subtasks = await getSubtasks(parentKey, SUMMARY_FIELDS);

  const siblings: SiblingContext[] = [];
  for (const subtask of subtasks) {
    if (subtask.key === ticket.key) continue; // the ticket itself, already fully read above

    const base: SiblingContext = {
      key: subtask.key,
      summary: subtask.fields.summary,
      description: adfToPlainText(subtask.fields.description),
    };

    const relevant = await isSiblingRelevant(base, failureArea);
    if (relevant) {
      const full = await getIssue(subtask.key, ['comment']);
      siblings.push({ ...base, comments: commentsToPlainText(full) });
    } else {
      siblings.push(base);
    }
  }

  context.parentStory = {
    key: parentIssue.key,
    summary: parentIssue.fields.summary,
    description: adfToPlainText(parentIssue.fields.description),
    siblings,
  };

  return context;
}
