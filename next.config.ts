import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { SENTRY_TUNNEL_ROUTE } from "./src/lib/observability/tunnel-route";
import { buildSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: buildSecurityHeaders() }]);
  },
};

// Sentry (PR 4.4): browser events go to SENTRY_TUNNEL_ROUTE, handled by src/app/sentry-tunnel/route.ts.
// Source maps are uploaded only when a build has SENTRY_AUTH_TOKEN (set in Vercel, never in the repo);
// without it the build is unchanged. Sentry's own build telemetry is off.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: SENTRY_TUNNEL_ROUTE,
  telemetry: false,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
