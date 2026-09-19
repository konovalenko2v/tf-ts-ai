import { OpenApiDocument } from './openapi-types';

export async function fetchSpec(specUrl: string): Promise<OpenApiDocument> {
  const response = await fetch(specUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec from ${specUrl}: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    // The DemoQA/restful-booker case this guards against: a URL that looks like a spec endpoint
    // but is actually an SPA fallback or HTML docs page returning `text/html` with status 200 —
    // no exception otherwise, just a document with no `paths`, failing confusingly much later.
    throw new Error(
      `${specUrl} did not return JSON (content-type: ${contentType || 'unknown'}) — this is likely an HTML page, not a machine-readable OpenAPI/Swagger document`,
    );
  }
  const doc = (await response.json()) as OpenApiDocument;
  if (!doc.paths || Object.keys(doc.paths).length === 0) {
    throw new Error(`${specUrl} parsed as JSON but has no paths — not a valid OpenAPI/Swagger document`);
  }
  if (!doc.swagger && !doc.openapi) {
    throw new Error(`${specUrl} has no 'swagger' or 'openapi' version field — not a recognized spec document`);
  }
  return doc;
}
