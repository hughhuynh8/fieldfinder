import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { sentryOptions } from "./sentry-options";
import { SENTRY_TUNNEL_ROUTE } from "./tunnel-route";

describe("sentryOptions", () => {
  it("is off without a DSN, so local runs, tests and CI send nothing", () => {
    expect(sentryOptions({})).toMatchObject({ dsn: undefined, enabled: false });
    expect(sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "  " })).toMatchObject({ enabled: false });
  });

  it("turns on with a DSN and names the Vercel environment", () => {
    const options = sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2", VERCEL_ENV: "preview" });
    expect(options).toMatchObject({ dsn: "https://k@o1.ingest.sentry.io/2", enabled: true, environment: "preview" });
  });

  it("collects errors only: no tracing, no replay, none of the SDK's automatic data collection", () => {
    const options = sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2" });
    expect(options.tracesSampleRate).toBe(0);
    expect(options).not.toHaveProperty("integrations"); // no replayIntegration() or anything else added
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    });
  });

  it("scrubs every event before it's sent", async () => {
    const options = sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2" });
    const event = {
      type: undefined,
      user: { ip_address: "203.0.113.9" },
      message: "at -37.8136, 144.9631",
    } as ErrorEvent;
    const sent = await options.beforeSend?.(event, {});
    expect(JSON.stringify(sent)).not.toMatch(/203\.0\.113\.9|-37\.8136/);
  });

  it("tunnels through a same-origin path, so the CSP needs no Sentry host", () => {
    expect(SENTRY_TUNNEL_ROUTE).toMatch(/^\/[a-z-]+$/);
  });
});
