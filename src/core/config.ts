import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  host: 'https://restful-booker.herokuapp.com',
  uiHost: 'https://demoqa.com/automation-practice-form',
  gqlHost: 'https://eu-central-1-shared-euc1-02.cdn.hygraph.com/content/clv6lwqu7000001w690st4vix/master',
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
