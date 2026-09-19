import { OpenApiDocument, OpenApiMethod, OpenApiOperation, OpenApiParameter, refName } from './openapi-types';

// Matches the shape every hand-written client in src/api/clients/*.client.ts already uses:
// constructor(request: APIRequestContext), one method per endpoint, method body is a single
// this.request.<verb>(url, opts) call returning the raw APIResponse untouched — callers decide
// what status/body to expect, the client never asserts or unwraps.

function paramsByLocation(params: OpenApiParameter[] | undefined, loc: OpenApiParameter['in']): OpenApiParameter[] {
  return (params ?? []).filter((p) => p.in === loc);
}

// OpenAPI 3.x nests a parameter's type under `schema.type`; Swagger 2.0 puts it directly on the
// parameter as `type`. Both are read so this keeps working against either spec version.
function tsParamType(param: OpenApiParameter, availableTypeNames: Set<string>): string {
  if (param.schema?.$ref) return safeTypeName(param.schema.$ref, availableTypeNames);
  const rawType = param.schema?.type ?? param.type;
  if (rawType === 'integer' || rawType === 'number') return 'number';
  if (rawType === 'boolean') return 'boolean';
  return 'string';
}

function requestBodyRef(op: OpenApiOperation): string | undefined {
  return op.requestBody?.content?.['application/json']?.schema?.$ref;
}

// camelCase(operationId) would collide with operationId's own casing conventions across specs
// (some are already camelCase, some kebab/snake) — operationId is used as the method name
// verbatim since Swagger/OpenAPI already requires it to be a valid identifier-ish token, and
// diverging from it would make the generated method harder to trace back to the spec.
function methodName(operationId: string | undefined, method: OpenApiMethod, urlPath: string): string {
  if (operationId) return operationId;
  // Fallback for a spec that omits operationId on some operations: derive a name from the path
  // and verb so every operation still gets a callable method instead of being silently dropped.
  const slug = urlPath
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((seg, i) => (i === 0 ? seg : seg[0].toUpperCase() + seg.slice(1)))
    .join('');
  return `${method}${slug[0].toUpperCase()}${slug.slice(1)}`;
}

// A $ref name is only safe to use as a type if it actually exists as a named export in the
// generated types barrel — a schema key that isn't a valid TS identifier (see
// generate-schema.ts's VALID_IDENTIFIER filter) never gets an alias there, and a Swagger 2.0 doc
// has no barrel generated at all (run.ts passes an empty set). Falling back to `unknown` for a
// name outside the available set avoids emitting an import for a type that doesn't exist, which
// `tsc` would only catch after burning a full AI-onboarding attempt to discover.
function safeTypeName(refTarget: string | undefined, availableTypeNames: Set<string>): string {
  if (!refTarget) return 'unknown';
  const name = refName(refTarget);
  return availableTypeNames.has(name) ? name : 'unknown';
}

function renderMethod(urlPath: string, method: OpenApiMethod, op: OpenApiOperation, availableTypeNames: Set<string>): string {
  const pathParams = paramsByLocation(op.parameters, 'path');
  const queryParams = paramsByLocation(op.parameters, 'query');
  // Swagger 2.0 represents a body as an `in: 'body'` parameter; OpenAPI 3.x moved it to the
  // sibling `requestBody` field instead — both are checked so either spec version gets a typed
  // body arg on the generated method.
  const swagger2BodyParam = paramsByLocation(op.parameters, 'body')[0];
  const openApi3BodyRef = requestBodyRef(op);
  const hasBody = swagger2BodyParam !== undefined || openApi3BodyRef !== undefined;
  const bodyType = safeTypeName(openApi3BodyRef ?? swagger2BodyParam?.schema?.$ref, availableTypeNames);

  // Required params must all precede optional ones in a TS parameter list (a required param after
  // an optional one is TS1016) — path and required-query params are never optional, so only the
  // trailing block (optional query params) can contain a `?`, regardless of the spec's own
  // parameter order or whether a body param (always required here) follows them.
  const args = [
    ...pathParams.map((p) => `${p.name}: ${tsParamType(p, availableTypeNames)}`),
    ...queryParams.filter((p) => p.required).map((p) => `${p.name}: ${tsParamType(p, availableTypeNames)}`),
    ...(hasBody ? [`body: ${bodyType}`] : []),
    ...queryParams.filter((p) => !p.required).map((p) => `${p.name}?: ${tsParamType(p, availableTypeNames)}`),
  ].join(', ');

  // Template-literal path with {param} substituted directly — Swagger/OpenAPI path templates
  // already use the same {param} syntax as a JS template literal once braces are kept as-is.
  const urlExpr = '`${this.baseUrl}' + urlPath.replace(/{(\w+)}/g, '${$1}') + '`';

  // An optional query param is typed `T | undefined` in the method signature, but Playwright's
  // `params` option is `Record<string, string | number | boolean>` — it doesn't accept `undefined`
  // as a value. Building the params object inline (`{ status }`) with an optional param in scope
  // would typecheck as `{ status: string | undefined }` and fail `tsc`. Assigning entries one at a
  // time, skipping `undefined` ones, keeps the object's inferred type free of `undefined`.
  const hasOptionalQueryParam = queryParams.some((p) => !p.required);
  const preLines: string[] = [];
  if (hasOptionalQueryParam) {
    preLines.push(`    const params: Record<string, string | number | boolean> = {};`);
    for (const p of queryParams) {
      preLines.push(p.required ? `    params.${p.name} = ${p.name};` : `    if (${p.name} !== undefined) params.${p.name} = ${p.name};`);
    }
  }

  const optsLines: string[] = [];
  if (queryParams.length > 0) {
    optsLines.push(hasOptionalQueryParam ? 'params' : `params: { ${queryParams.map((p) => p.name).join(', ')} }`);
  }
  if (hasBody) optsLines.push('data: body');
  const opts = optsLines.length > 0 ? `, {\n      ${optsLines.join(',\n      ')},\n    }` : '';

  const name = methodName(op.operationId, method, urlPath);
  return [`  async ${name}(${args}) {`, ...preLines, `    return this.request.${method}(${urlExpr}${opts});`, `  }`].join('\n');
}

// `availableTypeNames` is the set of names that actually exist in the generated types barrel
// (generate-schema.ts's emittableSchemaNames) — a Swagger 2.0 doc gets no barrel generated at all
// (run.ts passes an empty set), so every $ref there falls back to `unknown` instead of importing
// from a './types' module that was never written.
export function generateClientFile(doc: OpenApiDocument, className: string, baseUrl: string, availableTypeNames: Set<string>): string {
  const methods: string[] = [];
  for (const [urlPath, pathItem] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as OpenApiMethod[]) {
      const op = pathItem[method];
      if (!op) continue;
      methods.push(renderMethod(urlPath, method, op, availableTypeNames));
    }
  }

  const typeNames = new Set<string>();
  for (const pathItem of Object.values(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as OpenApiMethod[]) {
      const op = pathItem[method];
      if (!op) continue;
      for (const p of op.parameters ?? []) {
        if (p.schema?.$ref) typeNames.add(refName(p.schema.$ref));
      }
      // requestBodyRef covers OpenAPI 3.x's sibling `requestBody` field; Swagger 2.0 represents
      // the same thing as an `in: 'body'` parameter instead (see renderMethod's swagger2BodyParam).
      const swagger2BodyRef = paramsByLocation(op.parameters, 'body')[0]?.schema?.$ref;
      const bodyRef = requestBodyRef(op) ?? swagger2BodyRef;
      if (bodyRef) typeNames.add(refName(bodyRef));
    }
  }
  const importedTypeNames = [...typeNames].filter((name) => availableTypeNames.has(name));
  const typeImport = importedTypeNames.length > 0 ? `import { ${importedTypeNames.sort().join(', ')} } from './types';\n` : '';

  return [
    '// Generated by src/api-onboarder from the OpenAPI/Swagger document — do not hand-edit.',
    '// Re-run `npm run api-onboarder -- <spec-url>` to regenerate after the spec changes.',
    '',
    "import { APIRequestContext } from '@playwright/test';",
    typeImport,
    `export class ${className} {`,
    `  private readonly baseUrl = '${baseUrl}';`,
    '',
    '  constructor(private readonly request: APIRequestContext) {}',
    '',
    methods.join('\n\n'),
    '}',
    '',
  ].join('\n');
}
