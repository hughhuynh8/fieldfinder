import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

import { isSensitiveKey, REDACTED, scrubString } from "@/lib/log";

// Sentry scrubbing (PR 4.4, spec §7, ADR-0005, CLAUDE.md rule 3). The SDK's own collection is switched
// off in sentry-options.ts; this is the second layer, run on every event and breadcrumb before it
// leaves the process. It applies the same rules as the logger: coordinate, credential, cookie and IP
// keys are dropped at any depth, and strings lose query parameters, bearer tokens, connection-string
// passwords and coordinate-like numbers.
//
// Unlike redact() in log.ts it keeps deep structures (stack frames sit ~7 levels down) and long arrays,
// because a truncated stack trace is useless; it still stops at a hard depth to stay safe on cycles.

const MAX_DEPTH = 16;

function scrubValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => scrubValue(item, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(child, seen, depth + 1);
  }
  return out;
}

/** A URL without its query string or fragment: the path is enough to find a bug, the query isn't. */
function pathOnly(url: string): string {
  const cut = url.search(/[?#]/);
  return scrubString(cut === -1 ? url : url.slice(0, cut));
}

/** `beforeSend`: the event with nothing identifying a person, their location or a secret. */
export function scrubEvent<E extends ErrorEvent>(event: E): E {
  const scrubbed = scrubValue(event, new WeakSet(), 0) as E;

  // Who: never attach a user, an IP address or a server name.
  delete scrubbed.user;
  delete scrubbed.server_name;

  // Breadcrumbs were scrubbed when recorded (beforeBreadcrumb); do it again in case one wasn't.
  if (event.breadcrumbs) scrubbed.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);

  // The request: keep method and path only.
  if (event.request) {
    scrubbed.request = {
      ...(event.request.method ? { method: event.request.method } : {}),
      ...(event.request.url ? { url: pathOnly(event.request.url) } : {}),
    };
  }
  return scrubbed;
}

/** `beforeBreadcrumb`: navigation and fetch breadcrumbs keep only URL paths. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const scrubbed = scrubValue(breadcrumb, new WeakSet(), 0) as Breadcrumb;
  const data = breadcrumb.data;
  if (data && scrubbed.data) {
    for (const key of ["url", "from", "to"] as const) {
      const value: unknown = data[key];
      if (typeof value === "string") scrubbed.data[key] = pathOnly(value);
    }
  }
  return scrubbed;
}
