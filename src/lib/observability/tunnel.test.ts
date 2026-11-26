import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../../../tests/msw/server";

import { createTunnelHandler } from "./tunnel";

// The tunnel must forward the envelope but never the visitor's IP, cookies or location (PR 4.4).

const DSN = "https://publickey@o1.ingest.sentry.io/2";
const INGEST = "https://o1.ingest.sentry.io/api/2/envelope/";

function envelope(dsn: string): string {
  return `${JSON.stringify({ event_id: "0123456789abcdef0123456789abcdef", dsn })}\n{"type":"event"}\n{"message":"boom"}`;
}

function browserRequest(body: string): Request {
  return new Request("https://fieldfinder.test/monitoring?o=1&p=2", {
    method: "POST",
    body,
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "content-length": String(new TextEncoder().encode(body).length),
      "user-agent": "Mozilla/5.0 (iPhone)",
      "x-forwarded-for": "203.0.113.9",
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "cf-connecting-ip": "203.0.113.9",
      "x-vercel-ip-city": "Melbourne",
      "x-vercel-ip-latitude": "-37.81",
      cookie: "_ga=GA1.1.123",
      origin: "https://fieldfinder.test",
    },
  });
}

describe("Sentry tunnel", () => {
  it("forwards the envelope with no IP address, cookie or location header", async () => {
    let forwarded: { headers: Record<string, string>; body: string } | undefined;
    server.use(
      http.post(INGEST, async ({ request }) => {
        forwarded = { headers: Object.fromEntries(request.headers), body: await request.text() };
        return HttpResponse.json({ id: "0123456789abcdef0123456789abcdef" });
      }),
    );

    const body = envelope(DSN);
    const res = await createTunnelHandler(DSN)(browserRequest(body));

    expect(res.status).toBe(200);
    expect(forwarded?.body).toBe(body);
    const sent = JSON.stringify(forwarded?.headers);
    expect(sent).not.toMatch(/203\.0\.113\.9|Melbourne|-37\.81|GA1\.1\.123|fieldfinder\.test/);
    expect(Object.keys(forwarded?.headers ?? {})).not.toContain("x-sentry-forwarded-for");
    expect(forwarded?.headers["user-agent"]).toBe("Mozilla/5.0 (iPhone)");
  });

  it("refuses envelopes for any other Sentry project", async () => {
    const res = await createTunnelHandler(DSN)(browserRequest(envelope("https://other@o9.ingest.sentry.io/9")));
    expect(res.status).toBe(403);
  });

  it("refuses everything when Sentry isn't configured", async () => {
    const res = await createTunnelHandler(undefined)(browserRequest(envelope(DSN)));
    expect(res.status).toBe(500);
  });
});
