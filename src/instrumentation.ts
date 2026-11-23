import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

// Server and edge error monitoring (PR 4.4). Inert unless NEXT_PUBLIC_SENTRY_DSN is set.

export function register(): void {
  Sentry.init(sentryOptions());
}

// Errors thrown while rendering pages or in route handlers that don't catch them. API routes catch
// their own errors (src/lib/api/handler.ts) and report them there.
export const onRequestError = Sentry.captureRequestError;
