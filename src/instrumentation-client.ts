import "@/lib/validation/zod-browser";
import { startLazySentry } from "@/lib/observability/lazy-browser";
import { sentryOptions } from "@/lib/observability/sentry-options";

// Browser error monitoring (PR 4.4). Inert unless NEXT_PUBLIC_SENTRY_DSN was set at build time.
// No session replay and no tracing. Events go to our own /monitoring tunnel (next.config.ts).
// The SDK is loaded after the page has loaded and gone idle (PR 4.5), so it isn't part of the
// JavaScript needed to show the page; errors from before then are buffered (lazy-browser.ts).

void startLazySentry({
  options: sentryOptions(),
  load: () => import("@/lib/observability/browser-sdk"),
  target: window,
});
