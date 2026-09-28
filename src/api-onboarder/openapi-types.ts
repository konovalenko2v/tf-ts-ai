// Minimal shape of what this module actually reads from a Swagger 2.0 / OpenAPI 3.x document —
// not a full spec type. Both versions are handled since Swagger 2.0's `definitions` and OpenAPI
// 3's `components.schemas` differ only in where the schema map lives; `resolveSchemas()` below is
// the one place that difference is absorbed.

export interface OpenApiSchema {
  type?: string;
  format?: string;
  $ref?: string;
  enum?: string[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'body' | 'header' | 'formData';
  required?: boolean;
  type?: string;
  schema?: OpenApiSchema;
}

// OpenAPI 3.x dropped Swagger 2.0's `in: 'body'` parameter — a request body is a sibling field on
// the operation instead, keyed by media type. Only 'application/json' is read; a spec that only
// offers XML/form-urlencoded bodies produces a client method with no typed body parameter, which
// is a spec-coverage gap to notice in the generated file, not a crash.
export interface OpenApiRequestBody {
  required?: boolean;
  content?: Record<string, { schema?: OpenApiSchema }>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, { description?: string; schema?: OpenApiSchema }>;
}

export type OpenApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type OpenApiPathItem = Partial<Record<OpenApiMethod, OpenApiOperation>>;

export interface OpenApiDocument {
  swagger?: string;
  openapi?: string;
  info?: { title?: string };
  host?: string;
  basePath?: string;
  schemes?: string[];
  servers?: { url: string }[];
  paths: Record<string, OpenApiPathItem>;
  definitions?: Record<string, OpenApiSchema>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

export function resolveSchemas(doc: OpenApiDocument): Record<string, OpenApiSchema> {
  return doc.definitions ?? doc.components?.schemas ?? {};
}

// A spec's `security`/`securitySchemes` fields describe declared auth — but a session-cookie API
// (login sets a cookie, every other endpoint reads it) commonly leaves every operation's security
// undeclared, since the spec author never has to state "you need the cookie the login call gave
// you" for it to be true. Confirmed live against a demo API: /api/properties had no `security`
// entry at all yet returned 401 without a prior POST to /api/auth/login. A path/operationId
// heuristic is the only generic signal available — not perfect, but it's what catches this shape
// without hardcoding any one API's route names.
export function findLoginOperation(doc: OpenApiDocument): { path: string; operationId?: string } | undefined {
  for (const [urlPath, item] of Object.entries(doc.paths)) {
    const op = item.post;
    if (!op) continue;
    const haystack = `${urlPath} ${op.operationId ?? ''}`.toLowerCase();
    if (haystack.includes('login') || haystack.includes('signin')) {
      return { path: urlPath, operationId: op.operationId };
    }
  }
  return undefined;
}

// Swagger 2.0 refs are '#/definitions/Pet', OpenAPI 3 refs are '#/components/schemas/Pet' — the
// schema name is always the last path segment in both.
export function refName(ref: string): string {
  return ref.split('/').pop()!;
}

// OpenAPI 3.x commonly declares `servers[0].url` as a path relative to whatever host the spec
// itself was served from (e.g. '/api/v3') rather than an absolute URL — used as-is, that produces
// a client that can't reach the API at all. `fallbackOrigin` (scheme://host of the URL the spec
// document was actually fetched from, e.g. 'http://35.166.143.87:8080') is what a relative server
// URL, or a schemeless Swagger 2.0 doc, is really relative to. A bare host with no scheme (old
// callers, and this function's own tests) is still accepted and defaults to https, since that was
// always a safe assumption for a bare hostname — it's hardcoding 'https' regardless of the
// fetched origin's REAL scheme that was the bug (confirmed live: a plain-HTTP-only demo API,
// resolved via the doc.schemes-less last-resort branch below, got an https:// client and every
// request failed with an SSL protocol error, not a 404 or a real API error).
export function resolveBaseUrl(doc: OpenApiDocument, fallbackOrigin: string): string {
  const fallbackHasScheme = /^https?:\/\//.test(fallbackOrigin);
  const fallbackScheme = fallbackHasScheme ? fallbackOrigin.split('://')[0] : 'https';
  const fallbackHost = fallbackHasScheme ? fallbackOrigin.slice(fallbackScheme.length + 3) : fallbackOrigin;

  const serverUrl = doc.servers?.[0]?.url;
  if (serverUrl) {
    const resolved = /^https?:\/\//.test(serverUrl) ? serverUrl : `${fallbackScheme}://${fallbackHost}${serverUrl}`;
    return resolved.replace(/\/+$/, '');
  }
  const scheme = doc.schemes?.[0] ?? fallbackScheme;
  const host = doc.host ?? fallbackHost;
  const basePath = doc.basePath ?? '';
  return `${scheme}://${host}${basePath}`.replace(/\/+$/, '');
}
