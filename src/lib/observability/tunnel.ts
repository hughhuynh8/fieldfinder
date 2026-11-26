import "server-only";

import { createSentryTunnelRoute } from "@sentry/nextjs/tunnel";

// Sentry tunnel handler (PR 4.4), served at /monitoring via src/app/sentry-tunnel/route.ts.
//
// Sentry's own handler copies the visitor's IP into X-Sentry-Forwarded-For (from x-forwarded-for,
// x-vercel-forwarded-for or cf-connecting-ip) and forwards browser hints and Origin. We rebuild the
// request with an allowlist first, so Sentry receives the envelope, its length and type, and the user
// agent, never an IP address, cookie, or Vercel's geolocation headers. It still accepts envelopes for
// our DSN only, so the route can't relay events to anyone else's Sentry project.

const FORWARDED = ["content-type", "content-length", "user-agent"] as const;

export function createTunnelHandler(dsn: string | undefined): (request: Request) => Promise<Response> {
  const { POST } = createSentryTunnelRoute(dsn ? { allowedDsns: [dsn] } : {});
  return (request) => {
    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const stripped = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      // reason: Node needs duplex "half" to send a streamed body; lib.dom's RequestInit lacks it.
      duplex: "half",
    } as RequestInit);
    return POST(stripped);
  };
}
