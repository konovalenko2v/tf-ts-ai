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

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  parameters?: OpenApiParameter[];
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

export function resolveBaseUrl(doc: OpenApiDocument, fallbackHost: string): string {
  if (doc.servers?.[0]?.url) return doc.servers[0].url;
  const scheme = doc.schemes?.[0] ?? 'https';
  const host = doc.host ?? fallbackHost;
  const basePath = doc.basePath ?? '';
  return `${scheme}://${host}${basePath}`.replace(/\/+$/, '');
}
