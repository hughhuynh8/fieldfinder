// Public path the browser posts Sentry events to (PR 4.4). next.config.ts rewrites it to
// src/app/sentry-tunnel/route.ts. Kept in a file with no imports because next.config.ts loads it
// without the "@/" path alias.
export const SENTRY_TUNNEL_ROUTE = "/monitoring";
