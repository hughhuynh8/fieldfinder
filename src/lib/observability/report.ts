import * as Sentry from "@sentry/nextjs";

// Server-side reporting to Sentry (PR 4.4). Both functions do nothing until Sentry is initialised with
// a DSN (src/instrumentation.ts), so tests and local runs need no mocks. Events are scrubbed by
// sentry-options.ts before they're sent; still, pass only fields that are safe to log.

export type ExceptionReporter = (error: unknown, context: Record<string, string>) => void;
export type SignalReporter = (event: string, fields: Record<string, string | number>) => void;

/** An unexpected error. `context` becomes searchable tags (route name, request id). */
export const reportException: ExceptionReporter = (error, context) => {
  Sentry.captureException(error, { tags: context });
};

/** A security or abuse signal (not an error): a warning-level message grouped by its event name. */
export const reportSignal: SignalReporter = (event, fields) => {
  Sentry.captureMessage(event, { level: "warning", extra: fields, fingerprint: [event] });
};
