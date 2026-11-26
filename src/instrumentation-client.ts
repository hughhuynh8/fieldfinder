import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/observability/sentry-options";

// Browser error monitoring (PR 4.4). Inert unless NEXT_PUBLIC_SENTRY_DSN was set at build time.
// No session replay and no tracing. Events go to our own /monitoring tunnel (next.config.ts).

Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
