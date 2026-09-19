// Unit coverage for the deterministic half of src/api-onboarder — spec parsing and code
// generation never call an AI, so this can (and must) be tested the same way any other pure
// function in the framework is, without hitting a network or a CLI.
import { test, expect } from '@playwright/test';
import { generateClientFile } from '../../src/api-onboarder/generate-client';
import { emittableSchemaNames, generateTypesBarrel, supportsSchemaGeneration } from '../../src/api-onboarder/generate-schema';
import { resolveBaseUrl, resolveSchemas, refName, OpenApiDocument } from '../../src/api-onboarder/openapi-types';

const SAMPLE_DOC: OpenApiDocument = {
  swagger: '2.0',
  host: 'example.com',
  basePath: '/v1',
  schemes: ['https'],
  paths: {
    '/widgets': {
      get: {
        operationId: 'listWidgets',
        parameters: [{ name: 'status', in: 'query', type: 'string' }],
        responses: {},
      },
      post: {
        operationId: 'createWidget',
        parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Widget' } }],
        responses: {},
      },
    },
    '/widgets/{widgetId}': {
      get: {
        operationId: 'getWidget',
        parameters: [{ name: 'widgetId', in: 'path', required: true, type: 'integer' }],
        responses: {},
      },
    },
  },
  definitions: {
    Widget: {
      type: 'object',
      required: ['name'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['active', 'archived'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

// An OpenAPI 3.x equivalent of SAMPLE_DOC's /widgets POST — body moves from an `in: 'body'`
// parameter to the sibling `requestBody` field, and a query/path parameter's type moves from
// `param.type` to `param.schema.type`. Exercises the dual-path handling generate-client.ts needs
// to support either spec version from the same code.
const OPENAPI3_DOC: OpenApiDocument = {
  openapi: '3.0.0',
  servers: [{ url: 'https://example.com/v1' }],
  paths: {
    '/widgets': {
      post: {
        operationId: 'createWidget',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } } },
        responses: {},
      },
    },
    '/widgets/{widgetId}': {
      get: {
        operationId: 'getWidget',
        parameters: [{ name: 'widgetId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {},
      },
    },
  },
  components: {
    schemas: {
      Widget: {
        type: 'object',
        required: ['name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
      // Not a valid TS identifier — must be excluded from emittableSchemaNames and never imported
      // by the client, rather than producing an `export type application/vnd.widget+json = ...`.
      'application/vnd.widget+json': { type: 'object' },
    },
  },
};

test.describe('resolveBaseUrl', () => {
  test('builds from scheme+host+basePath when no servers array is present (Swagger 2.0)', () => {
    expect(resolveBaseUrl(SAMPLE_DOC, 'fallback.example')).toBe('https://example.com/v1');
  });

  test('prefers servers[0].url when present (OpenAPI 3)', () => {
    const doc: OpenApiDocument = { paths: {}, servers: [{ url: 'https://v3.example.com/api' }] };
    expect(resolveBaseUrl(doc, 'fallback.example')).toBe('https://v3.example.com/api');
  });

  test('resolves a relative servers[0].url against the fallback host (OpenAPI 3)', () => {
    const doc: OpenApiDocument = { paths: {}, servers: [{ url: '/api/v3' }] };
    expect(resolveBaseUrl(doc, 'petstore3.swagger.io')).toBe('https://petstore3.swagger.io/api/v3');
  });

  test('falls back to the given host when the doc has none', () => {
    const doc: OpenApiDocument = { paths: {}, schemes: ['https'] };
    expect(resolveBaseUrl(doc, 'fallback.example')).toBe('https://fallback.example');
  });
});

test.describe('resolveSchemas / refName', () => {
  test('reads Swagger 2.0 definitions', () => {
    expect(Object.keys(resolveSchemas(SAMPLE_DOC))).toEqual(['Widget']);
  });

  test('reads OpenAPI 3 components.schemas when definitions is absent', () => {
    const doc: OpenApiDocument = { paths: {}, components: { schemas: { Foo: { type: 'object' } } } };
    expect(Object.keys(resolveSchemas(doc))).toEqual(['Foo']);
  });

  test('extracts the schema name from either ref style', () => {
    expect(refName('#/definitions/Widget')).toBe('Widget');
    expect(refName('#/components/schemas/Widget')).toBe('Widget');
  });
});

test.describe('supportsSchemaGeneration', () => {
  test('is true for an OpenAPI 3.x document', () => {
    expect(supportsSchemaGeneration(OPENAPI3_DOC)).toBe(true);
  });

  test('is false for a Swagger 2.0 document — openapi-typescript only understands OAS 3.x', () => {
    expect(supportsSchemaGeneration(SAMPLE_DOC)).toBe(false);
  });
});

test.describe('emittableSchemaNames', () => {
  test('lists schema names that are valid TS identifiers', () => {
    expect(emittableSchemaNames(OPENAPI3_DOC)).toContain('Widget');
  });

  test('excludes a schema key that is not a valid TS identifier — it cannot become `export type <name>`', () => {
    expect(emittableSchemaNames(OPENAPI3_DOC)).not.toContain('application/vnd.widget+json');
  });
});

test.describe('generateTypesBarrel', () => {
  const output = generateTypesBarrel(OPENAPI3_DOC);

  test('emits a named alias over the schema.ts components index type', () => {
    expect(output).toContain("export type Widget = components['schemas']['Widget'];");
  });

  test('imports components from ./schema, not a hand-rolled definition', () => {
    expect(output).toContain("import { components } from './schema';");
  });

  test('is byte-identical across repeated calls on the same doc (deterministic re-onboarding)', () => {
    expect(generateTypesBarrel(OPENAPI3_DOC)).toBe(generateTypesBarrel(OPENAPI3_DOC));
  });
});

test.describe('generateClientFile', () => {
  const output = generateClientFile(SAMPLE_DOC, 'WidgetClient', 'https://example.com/v1');

  test('names each method after its operationId', () => {
    expect(output).toContain('async listWidgets(');
    expect(output).toContain('async createWidget(');
    expect(output).toContain('async getWidget(');
  });

  test('substitutes a path parameter into the URL template', () => {
    expect(output).toContain('${this.baseUrl}/widgets/${widgetId}');
  });

  test('builds an optional query parameter into params entry-by-entry, guarded against undefined', () => {
    expect(output).toContain('const params: Record<string, string | number | boolean> = {};');
    expect(output).toContain('if (status !== undefined) params.status = status;');
    expect(output).not.toContain('params: { status }');
  });

  test("passes a required query parameter inline through Playwright's params option", () => {
    const doc: OpenApiDocument = {
      ...SAMPLE_DOC,
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            parameters: [{ name: 'status', in: 'query', required: true, type: 'string' }],
            responses: {},
          },
        },
      },
    };
    const requiredOutput = generateClientFile(doc, 'WidgetClient', 'https://example.com/v1');
    expect(requiredOutput).toContain('params: { status }');
    expect(requiredOutput).not.toContain('const params: Record<string, string | number | boolean> = {};');
  });

  test("passes a body parameter through Playwright's data option, typed by its $ref", () => {
    expect(output).toContain('async createWidget(body: Widget)');
    expect(output).toContain('data: body');
  });

  test('imports only the referenced types, not every generated interface', () => {
    expect(output).toContain("import { Widget } from './types';");
  });

  test('never asserts on the response — returns the raw APIResponse for the caller to inspect', () => {
    expect(output).not.toContain('expect(');
  });
});

test.describe('generateClientFile — OpenAPI 3.x dual-path handling', () => {
  const output = generateClientFile(OPENAPI3_DOC, 'WidgetClient', 'https://example.com/v1');

  test('reads a request body from the requestBody field, not an in:"body" parameter', () => {
    expect(output).toContain('async createWidget(body: Widget)');
    expect(output).toContain('data: body');
  });

  test("reads a path parameter's type from param.schema.type, not param.type", () => {
    expect(output).toContain('async getWidget(widgetId: number)');
  });

  test('orders a required body param before an optional query param — a required param cannot follow an optional one (TS1016)', () => {
    const doc: OpenApiDocument = {
      ...OPENAPI3_DOC,
      paths: {
        '/widgets': {
          post: {
            operationId: 'createWidget',
            parameters: [{ name: 'dryRun', in: 'query', schema: { type: 'boolean' } }],
            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } } },
            responses: {},
          },
        },
      },
    };
    const orderedOutput = generateClientFile(doc, 'WidgetClient', 'https://example.com/v1');
    expect(orderedOutput).toContain('async createWidget(body: Widget, dryRun?: boolean)');
  });
});

test.describe('generateClientFile — availableTypeNames filtering', () => {
  test('imports a $ref type that is in the available set', () => {
    const output = generateClientFile(OPENAPI3_DOC, 'WidgetClient', 'https://example.com/v1', new Set(['Widget']));
    expect(output).toContain("import { Widget } from './types';");
    expect(output).toContain('body: Widget');
  });

  test('falls back to `unknown` for a $ref type that was filtered out of the barrel (non-identifier schema key)', () => {
    const output = generateClientFile(OPENAPI3_DOC, 'WidgetClient', 'https://example.com/v1', new Set([]));
    expect(output).not.toContain('import { Widget }');
    expect(output).toContain('body: unknown');
  });
});
