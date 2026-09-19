// Unit coverage for the deterministic half of src/api-onboarder — spec parsing and code
// generation never call an AI, so this can (and must) be tested the same way any other pure
// function in the framework is, without hitting a network or a CLI.
import { test, expect } from '@playwright/test';
import { generateTypesFile } from '../../src/api-onboarder/generate-types';
import { generateClientFile } from '../../src/api-onboarder/generate-client';
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

test.describe('resolveBaseUrl', () => {
  test('builds from scheme+host+basePath when no servers array is present (Swagger 2.0)', () => {
    expect(resolveBaseUrl(SAMPLE_DOC, 'fallback.example')).toBe('https://example.com/v1');
  });

  test('prefers servers[0].url when present (OpenAPI 3)', () => {
    const doc: OpenApiDocument = { paths: {}, servers: [{ url: 'https://v3.example.com/api' }] };
    expect(resolveBaseUrl(doc, 'fallback.example')).toBe('https://v3.example.com/api');
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

test.describe('generateTypesFile', () => {
  const output = generateTypesFile(SAMPLE_DOC);

  test('marks required properties without "?" and optional ones with it', () => {
    expect(output).toContain('name: string;');
    expect(output).toContain('id?: number;');
  });

  test('renders a string enum as a union type', () => {
    expect(output).toContain("status?: 'active' | 'archived';");
  });

  test('renders an array property using its item type', () => {
    expect(output).toContain('tags?: string[];');
  });

  test('is byte-identical across repeated calls on the same doc (deterministic re-onboarding)', () => {
    expect(generateTypesFile(SAMPLE_DOC)).toBe(generateTypesFile(SAMPLE_DOC));
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

  test("passes a query parameter through Playwright's params option, not string concatenation", () => {
    expect(output).toContain('params: { status }');
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
