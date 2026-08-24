// mcp__atlassian__* tools (used to design/verify this against the real PET project) are Claude
// Code tools — only callable from a chat session, never from a script running under `npm run` in
// CI. This is the same functionality (getJiraIssue, JQL search) called directly against the Jira
// Cloud REST API v3, authenticated the way any headless script must be: Basic Auth with an
// Atlassian API token, not the browser-based OAuth flow `claude mcp login` uses.

import { requireEnv } from '../core/config';

export interface JiraCommentBody {
  version: number;
  type: 'doc';
  content: unknown[];
}

export interface JiraComment {
  body: JiraCommentBody | string;
}

export interface JiraIssueFields {
  summary: string;
  description: JiraCommentBody | string | null;
  parent?: { key: string };
  comment?: { comments: JiraComment[] };
}

export interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
}

function jiraBaseUrl(): string {
  return requireEnv('JIRA_BASE_URL'); // e.g. https://konovalenko2v.atlassian.net
}

function authHeader(): string {
  const email = requireEnv('JIRA_EMAIL');
  const token = requireEnv('JIRA_API_TOKEN');
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

async function jiraFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${jiraBaseUrl()}${path}`, {
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Jira API ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function getIssue(key: string, fields: string[]): Promise<JiraIssue> {
  const query = new URLSearchParams({ fields: fields.join(',') });
  return jiraFetch<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}?${query}`);
}

export async function getSubtasks(parentKey: string, fields: string[]): Promise<JiraIssue[]> {
  // /rest/api/3/search (the old GET JQL endpoint) returns 410 Gone as of the migration Atlassian
  // announced — /rest/api/3/search/jql is its replacement, same shape.
  const query = new URLSearchParams({
    jql: `parent = ${parentKey}`,
    fields: fields.join(','),
  });
  const result = await jiraFetch<{ issues: JiraIssue[] }>(`/rest/api/3/search/jql?${query}`);
  return result.issues;
}

// Jira's Atlassian Document Format stores rich text as a nested content tree, not plain text —
// this walks it recursively and joins every text node, which is lossy (no formatting/links) but
// is exactly what's needed here: plain text for a model prompt, not a faithful re-render.
export function adfToPlainText(doc: JiraCommentBody | string | null | undefined): string {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;

  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return parts.join(' ').trim();
}

export function commentsToPlainText(issue: JiraIssue): string[] {
  return (issue.fields.comment?.comments ?? []).map((c) => adfToPlainText(c.body));
}
