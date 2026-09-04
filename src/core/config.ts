import * as dotenv from 'dotenv';

dotenv.config();

// Base URLs come from the environment so the same suite can be pointed at a different deployment
// (a staging copy, a preview environment, a locally-served build) without editing source. The
// defaults are the public demo services this repo was built against, so an unconfigured checkout
// still runs exactly as before — but nothing here is a hardcoded destination any more.
//
// Only the three BASE hosts are configurable; the per-page paths below are derived from them
// rather than listed independently, since a UI deployment moves as a whole. That also removes the
// previous repetition of 'https://demoqa.com' across six separate entries, where changing the host
// meant changing every one of them and missing one was silent.
function envUrl(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.replace(/\/+$/, ''); // tolerate a trailing slash in the env value
}

const apiHost = envUrl('API_BASE_URL', 'https://restful-booker.herokuapp.com');
const uiBaseHost = envUrl('UI_BASE_URL', 'https://demoqa.com');
const gqlHost = envUrl('GRAPHQL_BASE_URL', 'https://eu-central-1-shared-euc1-02.cdn.hygraph.com/content/clv6lwqu7000001w690st4vix/master');

export const config = {
  host: apiHost,
  gqlHost,

  /** Base of the DemoQA UI deployment — also the Book Store API's host. */
  bookStoreHost: uiBaseHost,

  uiHost: `${uiBaseHost}/automation-practice-form`,
  textBoxHost: `${uiBaseHost}/text-box`,
  checkBoxHost: `${uiBaseHost}/checkbox`,
  buttonsHost: `${uiBaseHost}/buttons`,
  webTablesHost: `${uiBaseHost}/webtables`,
  bookStoreListHost: `${uiBaseHost}/books`,
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Test Run Error! Please check env variable ${name} in test run: ${value}`);
  }
  return value;
}

export function getValidUserName(): string {
  return requireEnv('BOOKER_USERNAME');
}

export function getValidUserPassword(): string {
  return requireEnv('USER_PASSWORD');
}
