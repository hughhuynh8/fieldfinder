import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

import { scrubBreadcrumb, scrubEvent } from "./scrub";

// One Sentry configuration for server, edge and browser (PR 4.4). Errors only: no performance tracing,
// no session replay, no logs, and none of the SDK's automatic collection of users, cookies, headers,
// bodies or query strings. Every event and breadcrumb is scrubbed again on the way out (scrub.ts).
//
// Sentry is off unless NEXT_PUBLIC_SENTRY_DSN is set, so local runs, tests and CI send nothing. The DSN
// is not a secret (it only allows sending events); browser events go through our own /monitoring
// tunnel, so no Sentry host appears in the CSP and Sentry never sees a visitor's IP address.

type Env = Record<string, string | undefined>;

// Literal process.env reads: Next inlines NEXT_PUBLIC_* values into the browser bundle only where the
// code names them like this, so a lookup through a variable would come back undefined there.
const buildEnv = (): Env => ({
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
});

export function sentryOptions(env: Env = buildEnv()): NodeOptions & BrowserOptions {
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
  return {
    dsn,
    enabled: dsn !== undefined,
    environment: env.NEXT_PUBLIC_VERCEL_ENV ?? env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}
