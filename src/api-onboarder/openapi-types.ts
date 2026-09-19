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

// Swagger 2.0 refs are '#/definitions/Pet', OpenAPI 3 refs are '#/components/schemas/Pet' — the
// schema name is always the last path segment in both.
export function refName(ref: string): string {
  return ref.split('/').pop()!;
}

// OpenAPI 3.x commonly declares `servers[0].url` as a path relative to whatever host the spec
// itself was served from (e.g. '/api/v3') rather than an absolute URL — used as-is, that produces
// a client that can't reach the API at all. `fallbackHost` (the host the spec document was fetched
// from) is what a relative server URL is actually relative to.
export function resolveBaseUrl(doc: OpenApiDocument, fallbackHost: string): string {
  const serverUrl = doc.servers?.[0]?.url;
  if (serverUrl) {
    const resolved = /^https?:\/\//.test(serverUrl) ? serverUrl : `https://${fallbackHost}${serverUrl}`;
    return resolved.replace(/\/+$/, '');
  }
  const scheme = doc.schemes?.[0] ?? 'https';
  const host = doc.host ?? fallbackHost;
  const basePath = doc.basePath ?? '';
  return `${scheme}://${host}${basePath}`.replace(/\/+$/, '');
}
