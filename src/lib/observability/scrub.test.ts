import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent } from "./scrub";

// PR 4.4 acceptance: "a Sentry event fixture is scrubbed". The fixture is shaped like a real browser
// event from the search page, with everything the privacy rules forbid planted in it (synthetic values).

const TOKEN = "synthetic-bearer-not-a-real-token";
const DB_URL = "postgres://ff_public_reader:hunter2-not-real@db.example.test:6543/postgres";

function fixture(): ErrorEvent {
  return {
    type: undefined,
    event_id: "0123456789abcdef0123456789abcdef",
    level: "error",
    platform: "javascript",
    server_name: "ip-10-0-0-12",
    message: `Search failed near -37.8136, 144.9631 with Bearer ${TOKEN}`,
    user: { id: "u1", ip_address: "203.0.113.9", geo: { city: "Melbourne", country_code: "AU" } },
    request: {
      method: "GET",
      url: "https://fieldfinder.test/?lat=-37.8136&lng=144.9631&radiusKm=10",
      query_string: "lat=-37.8136&lng=144.9631",
      cookies: { _ga: "GA1.1.123" },
      headers: { authorization: `Bearer ${TOKEN}`, cookie: "_ga=GA1.1.123", "user-agent": "Mozilla/5.0" },
      data: { lat: -37.8136, lng: 144.9631 },
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: `Cannot read properties of undefined (connecting to ${DB_URL})`,
          stacktrace: {
            frames: [
              {
                filename: "app:///_next/static/chunks/search.js",
                function: "loadResults",
                lineno: 42,
                colno: 7,
                in_app: true,
                vars: { latitude: -37.8136, query: "?lat=-37.8136&lng=144.9631", apiKey: "pk.secret" },
              },
              { filename: "app:///_next/static/chunks/map.js", function: "onMoveEnd", lineno: 9, colno: 3 },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "navigation", data: { from: "/", to: "/?lat=-37.8136&lng=144.9631" } },
      { category: "fetch", data: { method: "GET", url: "/api/venues?lat=-37.814&lng=144.963", status_code: 500 } },
    ],
    extra: { token: TOKEN, databaseUrl: DB_URL, coords: [-37.8136, 144.9631], note: "lat=-37.8136" },
    contexts: { os: { name: "iOS" }, geo: { region: "VIC" } },
    tags: { route: "venues.search" },
  };
}

describe("scrubEvent", () => {
  const scrubbed = scrubEvent(fixture());
  const text = JSON.stringify(scrubbed);

  it("removes every planted coordinate, token, password, cookie and IP address", () => {
    for (const forbidden of [
      "-37.8136",
      "144.9631",
      "-37.814",
      "144.963",
      TOKEN,
      "hunter2",
      "pk.secret",
      "203.0.113.9",
      "GA1.1.123",
      "ip-10-0-0-12",
      "Melbourne",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("drops the user and server name, and keeps only the request method and path", () => {
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.request).toEqual({ method: "GET", url: "https://fieldfinder.test/" });
  });

  it("keeps what's needed to debug: the error type, message shape, stack frames and tags", () => {
    const exception = scrubbed.exception?.values?.[0];
    expect(exception?.type).toBe("TypeError");
    expect(exception?.value).toContain("Cannot read properties of undefined");
    expect(exception?.stacktrace?.frames?.map((frame) => [frame.function, frame.lineno])).toEqual([
      ["loadResults", 42],
      ["onMoveEnd", 9],
    ]);
    expect(scrubbed.message).toContain("Search failed near");
    expect(scrubbed.tags).toEqual({ route: "venues.search" });
    expect(scrubbed.contexts?.os).toEqual({ name: "iOS" });
  });

  it("keeps breadcrumb URLs as paths only", () => {
    expect(scrubbed.breadcrumbs?.map((crumb) => crumb.data)).toEqual([
      { from: "/", to: "/" },
      { method: "GET", url: "/api/venues", status_code: 500 },
    ]);
  });

  it("doesn't change the input event", () => {
    const original = fixture();
    scrubEvent(original);
    expect(original).toEqual(fixture());
  });

  it("survives cycles", () => {
    const event = fixture();
    (event.extra as Record<string, unknown>).self = event;
    expect(() => scrubEvent(event)).not.toThrow();
  });
});

describe("scrubBreadcrumb", () => {
  it("strips query strings from fetch, xhr and navigation breadcrumbs", () => {
    const crumbs: Breadcrumb[] = [
      { category: "xhr", data: { url: "https://fieldfinder.test/api/locations/reverse?lat=-37.81&lng=144.96" } },
      { category: "navigation", data: { from: "/venues/x?ref=1", to: "/?lat=-37.81&lng=144.96#map" } },
      { category: "console", message: `token ${TOKEN} at -37.8136, 144.9631` },
    ];
    const out = crumbs.map(scrubBreadcrumb);
    expect(out[0]?.data).toEqual({ url: "https://fieldfinder.test/api/locations/reverse" });
    expect(out[1]?.data).toEqual({ from: "/venues/x", to: "/" });
    expect(out[2]?.message).not.toMatch(/-37\.8136|144\.9631/);
  });
});
