// Loads the Sentry browser SDK after the page has loaded and gone idle, rather than in the first
// bundle (PR 4.5, Hugh's choice). It keeps the SDK out of the JavaScript the browser needs before it
// can show and hydrate the page.
//
// Errors thrown before the SDK arrives aren't lost: early listeners keep up to MAX_BUFFERED of them
// and hand them to Sentry once it has started. The SDK then installs its own global handlers.
// With no DSN (local, tests, CI) nothing is loaded and no listener is added.

export const MAX_BUFFERED = 10;
/** Longest the SDK waits for an idle moment after the load event before starting anyway. */
export const IDLE_TIMEOUT_MS = 5000;

export interface LazySdk {
  init(options: unknown): void;
  captureException(error: unknown): void;
}

export interface LazySentryOptions<O> {
  /** Sentry options; nothing happens unless `enabled` is true. */
  options: O & { enabled?: boolean };
  /** Imports the SDK: `() => import("@/lib/observability/browser-sdk")`. */
  load: () => Promise<LazySdk>;
  /** The window, or a stand-in in tests. */
  target: Pick<Window, "addEventListener" | "removeEventListener"> & { document: Pick<Document, "readyState"> };
  /** Runs `start` when the browser is idle (requestIdleCallback, with a timeout fallback). */
  whenIdle?: (start: () => void) => void;
}

function defaultWhenIdle(start: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(start, 1);
  }
}

/** Starts Sentry lazily. Returns a promise that settles once the SDK has started (or failed to). */
export function startLazySentry<O>({
  options,
  load,
  target,
  whenIdle = defaultWhenIdle,
}: LazySentryOptions<O>): Promise<void> {
  if (options.enabled !== true) return Promise.resolve();

  const buffered: unknown[] = [];
  const keep = (error: unknown) => {
    if (buffered.length < MAX_BUFFERED) buffered.push(error);
  };
  const onError = (event: Event) => {
    keep((event as ErrorEvent).error ?? (event as ErrorEvent).message);
  };
  const onRejection = (event: Event) => {
    keep((event as PromiseRejectionEvent).reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  const stopBuffering = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };

  return new Promise<void>((resolve) => {
    const start = () => {
      load()
        .then((sdk) => {
          sdk.init(options);
          stopBuffering();
          for (const error of buffered.splice(0)) sdk.captureException(error);
        })
        // The SDK chunk failed to download (offline, blocked): stop buffering and carry on silently.
        .catch(stopBuffering)
        .finally(resolve);
    };
    const afterLoad = () => {
      whenIdle(start);
    };
    if (target.document.readyState === "complete") afterLoad();
    else target.addEventListener("load", afterLoad, { once: true });
  });
}
