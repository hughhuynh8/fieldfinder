# Monitoring and alerts

Ticket 4.4. What the app reports, where to look, and the alert rules to set up. Spec §6–§7, ADR-0004, ADR-0005.

## What the app sends where

| Signal                                                  | Source                                                                                       | Where it goes                                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unexpected server errors (API 500s, page render errors) | `apiRoute()` in `src/lib/api/handler.ts`, `onRequestError` in `src/instrumentation.ts`       | Sentry, tagged `route` and `requestId`; also an `api.unhandled_error` log line                                               |
| Browser errors                                          | `src/instrumentation-client.ts`                                                              | Sentry, through our `/monitoring` tunnel                                                                                     |
| Rate-limited requests (429)                             | Edge: Vercel Firewall rules. Admin API: the Postgres limiter (`docs/security/edge-rules.md`) | Edge 429s never reach the app: Vercel Firewall traffic view. Admin 429s: `api.request` log lines with `code: "rate_limited"` |
| Search errors                                           | `GET /api/venues`                                                                            | 4xx: `api.request` with `route: "venues.search"` and a `code`. 5xx: `api.unhandled_error` plus a Sentry issue                |
| Possible map enumeration                                | `src/features/search/enumeration.ts`                                                         | `search.enumeration_suspected` warning log line and a Sentry warning (one issue, grouped by name)                            |

None of these carry a coordinate, an IP address, a cookie or a token. Logs go through the redacting logger (`src/lib/log.ts`). Sentry events go through `scrubEvent` / `scrubBreadcrumb` (`src/lib/observability/scrub.ts`), and the SDK's own collection of users, cookies, headers, bodies and query strings is switched off (`sentry-options.ts`). Browser events reach Sentry through `/monitoring`, which forwards the envelope and the user agent only (`tunnel.ts`), so Sentry never sees a visitor's IP address. There is no session replay and no performance tracing.

### The enumeration heuristic

For each client (an IPv4 address or an IPv6 /64, held only as a keyed hash), each server instance counts the distinct 0.1° tiles (about 10 km) it searched in a 10-minute window. More than **25** tiles in one window raises one warning for that window. Typical use is a few places and a few "Search this area" moves; walking the Melbourne metro area takes about 50 tiles.

- **In memory only, by decision:** no Redis (D5), and nothing about tiles or coordinates is stored. A scraper spread across instances or edge regions is undercounted. It's an alert for a person to look at, never a block. Blocking stays with the edge rules.
- **Cached searches aren't counted.** The CDN answers repeats for 60 s, but a scan of new areas misses the cache, which is exactly what this counts.
- The threshold and window are hypotheses (`DISTINCT_TILE_THRESHOLD`, `WINDOW_MS`). Tune them against real warnings.
- The `client` field is a 16-hex-character hash that's stable across instances (keyed with `SEARCH_CURSOR_SECRET`), so repeated warnings for one client can be grouped. It can't be turned back into an IP.

## Setting up Sentry (Hugh)

1. Create a Sentry organisation and one project, platform **Next.js**. The Developer plan is enough to start; alerts by email are included.
2. In **Project Settings → Security & Privacy**, turn on **Prevent Storing of IP Addresses** and keep **Data Scrubber** and **Use Default Scrubbers** on. These back up the app's own scrubbing.
3. In Vercel, for **Preview** and **Production**:
   - `NEXT_PUBLIC_SENTRY_DSN`: the project's DSN. It isn't secret, but it's read at build time, so redeploy after setting it.
   - Optional, for readable stack traces: `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN`, an organisation token with the `project:releases` scope. The token is a secret: Vercel only, never the repo.
4. Leave all four empty for local development and CI: Sentry is then off and the build is unchanged.
5. Add an edge rule for the tunnel (proposed; apply with the others in `edge-rules.md`): `POST /monitoring`, 30 requests per 60 s per IP, action `rate_limit`. The tunnel only accepts our own DSN, but this stops anyone burning the Sentry quota.

## Alert rules

Create these in Sentry (**Alerts → Create Alert**) for the production environment:

| Alert                | Type        | Condition                                                                | Action                                                                  |
| -------------------- | ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| New error            | Issue alert | A new issue is created, `environment:production`                         | Email Hugh                                                              |
| Error spike          | Issue alert | An issue is seen more than 20 times in 1 hour                            | Email Hugh                                                              |
| Possible enumeration | Issue alert | Message `search.enumeration_suspected` is seen, `environment:production` | Email Hugh; then check the Vercel Firewall traffic view for that period |

For 429s, use the Vercel Firewall view (**Project → Firewall → Traffic**): it shows which rule limited how many requests. If one rule limits more than about 1% of its route's traffic for a day, revisit the threshold in `edge-rules.md` before assuming abuse.

Useful log searches in Vercel (**Project → Logs**, filter on the JSON fields):

- `event:api.unhandled_error`: every 500, with `route` and `requestId` (the same id is on the Sentry issue and in the client's `x-request-id`).
- `event:api.request code:rate_limited`: admin requests limited by the app.
- `event:api.request route:venues.search status:5*`: failed searches.
- `event:search.enumeration_suspected`: enumeration warnings, with `client`, `distinctTiles` and `threshold`.

## Checking it works on staging

Once the DSN is set on Preview:

1. Open the preview, and in the browser console run `setTimeout(() => { throw new Error("sentry staging check") })`. An issue should appear in Sentry within a minute.
   - Its event should show the page path without a query string, no user, and no IP address.
2. Confirm the "New error" alert email arrives.
3. Record the date, the issue link and a screenshot in `docs/planning/evidence/` (ticket 4.4 acceptance: "an alert rule is documented and triggered on staging").
