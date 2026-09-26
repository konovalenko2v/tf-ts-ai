import { test as base } from '@playwright/test';
import { AuthClient } from './clients/auth.client';
import { BookingClient } from './clients/booking.client';
import { AuthSteps } from './steps/auth.steps';
import { BookingSteps } from './steps/booking.steps';
import { GraphQlClient } from '../graphql/client';

// Thin wrappers over the built-in `request` fixture — one instance per test, same lifetime as
// `request` itself, so there's nothing here to dispose. GraphQlClient stays on config.gqlHost
// (an absolute URL with its own path), so it works whether or not a project sets use.baseURL.
type ApiFixtures = {
  authClient: AuthClient;
  bookingClient: BookingClient;
  authSteps: AuthSteps;
  bookingSteps: BookingSteps;
  graphqlClient: GraphQlClient;
};

export const test = base.extend<ApiFixtures>({
  authClient: async ({ request }, use) => use(new AuthClient(request)),
  bookingClient: async ({ request }, use) => use(new BookingClient(request)),
  authSteps: async ({ request }, use) => use(new AuthSteps(request)),
  bookingSteps: async ({ request }, use) => use(new BookingSteps(request)),
  graphqlClient: async ({ request }, use) => use(new GraphQlClient(request)),
});
export { expect } from '@playwright/test';
