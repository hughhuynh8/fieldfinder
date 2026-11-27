# M4 security and performance review (PR 4.5)

Reviewed: `main` at `4479b26` (after PR 4.4), plus the fixes in this PR. Method: the security-reviewer skill's checklist (spec §4–§7 and §10, ADR-0002 to ADR-0006, CLAUDE.md rule 3), code reading, local builds, and a Playwright scan of every page type. Nothing was run against production. The #93 Vercel preview was only read, apart from one synthetic test event sent to the Sentry tunnel.

This report lists findings and the risk that remains. It does not claim the app is secure.

## Data classes

| Class             | Examples                                                                                 | Where it may go                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Public, published | Published venues, pitches and media; allowlisted DTO fields                              | API responses, SSR HTML, JSON-LD, sitemap, Sentry (route names only)                             |
| Private master    | Drafts, notes, verifications, provenance, unpublished media, revisions                   | Admin API only (writer role)                                                                     |
| Secret            | DB role passwords, admin tokens, cursor secret, Mapbox secret token, `SENTRY_AUTH_TOKEN` | Server env (Vercel) only                                                                         |
| Personal          | A visitor's position, typed place, IP address                                            | Position rounded (2 dp device, 3 dp place) in URLs; IP used for rate limiting only, then dropped |

## Findings

| ID  | Severity | Status                         | Summary                                            |
| --- | -------- | ------------------------------ | -------------------------------------------------- |
| H1  | High     | **Fixed in this PR**           | CSP was report-only, so it blocked nothing         |
| M1  | Medium   | Rule written; **Hugh applies** | The Sentry tunnel had no edge rate limit           |
| L1  | Low      | **Hugh deletes**               | Four duplicate Firewall rules are live             |
| L2  | Low      | **Hugh commits**               | The Firewall export files aren't committed         |
| L3  | Low      | Open (Sentry setting)          | Sentry stores the sending server's IP and location |
| L4  | Low      | Open (decide in 4.6)           | HSTS has no `preload`                              |

### H1 — CSP was report-only (fixed)

- **Where:** `src/lib/security/headers.ts:53`. The header was `Content-Security-Policy-Report-Only`, with no `report-uri` or `report-to`.
- **Impact:** the policy had no effect and sent no reports. If an XSS bug were added later, an injected `<script src>` from any origin would run, and the page could send data anywhere. No XSS sink was found: React escapes text, and JSON-LD goes through `serializeJsonLd`, which escapes `<`, `>`, `&`, U+2028 and U+2029. So this is a missing defence-in-depth control, not an exploitable bug today. It's rated High because the plan required an enforced CSP before production (PR 1.6 → M3/M4).
- **Fix (Hugh chose "enforce the current policy"):**
  - The header is now `Content-Security-Policy`.
  - Two warnings were found by a Playwright scan (and by Hugh on the preview), and both are fixed:
    - **Vercel Toolbar** (`vercel.live`): preview builds only (`VERCEL_ENV=preview`) add the toolbar's origins. Production and local builds don't.
    - **Zod 4's `Function("")` probe:** Zod tests whether it may compile validators by calling `Function("")`, which a CSP without `'unsafe-eval'` blocks. Zod already fell back, so nothing broke, but every page logged a violation. `src/lib/validation/zod-browser.ts` turns on Zod's `jitless` mode in the browser. The server keeps compiled validators.
  - After the fix, every page type showed no violations. Pages scanned: `/` (with analytics consent), a search with the real Mapbox library, a venue page with the lightbox open, a pitch page, `/privacy`, `/terms`, a 404, and a page whose error went through `/monitoring`.
  - Tests:
    - `headers.test.ts`: enforced, never report-only; toolbar origins on preview builds only.
    - `smoke.spec.ts`: no report-only header.
- **Residual:** `script-src` still allows `'unsafe-inline'`, because Next.js emits inline bootstrap scripts, so an injected inline script would still run. Removing it needs per-request nonces (`proxy.ts`), which make every page dynamic. That's a follow-up ticket.

### M1 — Sentry tunnel had no edge rate limit

- **Where:** `POST /monitoring` (`src/app/sentry-tunnel/route.ts`). It isn't in `edge-rules.export.json`. `monitoring.md` proposed the rule in 4.4.
- **Impact:** the DSN is public, as all browser DSNs are, and the tunnel accepts any envelope for our DSN. Anyone can flood it, using up the Sentry event quota and hiding real errors. Each request also costs a function invocation.
- **Fix:** rule 7, `sentry-tunnel` (30 per minute per IP), is now in `edge-rules.md` with its CLI command. **Hugh applies it**, then re-exports.

### L1 — Duplicate Firewall rules

- **Where:** `docs/security/edge-rules.export.json`. `Admin children rate limit`, `Venues exact rate limit`, `Venues children rate limit` and `Locations children rate limit` duplicate rules 1–4, with the same paths and limits.
- **Impact:** no security gap: the limits are identical. But they use up custom-rule slots, and they'd silently keep the old limit if rules 1–4 are ever loosened.
- **Fix:** delete them in the dashboard and re-export (noted in `edge-rules.md`).

### L2 — Firewall export not committed

- **Where:** `docs/security/edge-rules.export.json` and `edge-rules.bot-management.json` exist locally but aren't in git. `edge-rules.md` → "Export (committed evidence)".
- **Impact:** the repo doesn't show which rules are live, so a reviewer can't check the deployed rules against the source of truth.
- **Fix:** after M1 and L1, Hugh re-exports, reads both files (rule names, conditions and actions only), and commits them. The current files contain no tokens.

### L3 — Sentry stores the sending server's IP

- **Where:** Sentry project settings. Seen on the #93 preview: an event arrived with `ip_address` `54.153.207.93` (Vercel, Sydney) and geo "Sydney".
- **Impact:** the tunnel works as intended. Sentry never sees a visitor's IP, only Vercel's. Storing even that is unnecessary.
- **Fix:** turn on **Prevent Storing of IP Addresses** in the Sentry project (Settings → Security & Privacy).

### L4 — HSTS without `preload`

- **Where:** `src/lib/security/headers.ts`: `max-age=63072000; includeSubDomains`.
- **Impact:** the first visit to a new domain can still be downgraded.
- **Fix:** decide when the production domain is set up (4.6). Preloading is hard to undo.

## Checked with no findings

- **Public boundary:**
  - Detail pages, API, sitemap and JSON-LD read through `publicDb()` (the reader role, views of published rows only) and DTO mappers.
  - The sitemap is built per request.
  - No `dangerouslySetInnerHTML` other than JSON-LD, which is escaped.
  - Preview source maps return 404, and no `sourceMappingURL` is shipped. Maps go to Sentry only.
- **Admin:**
  - Every route under `src/app/api/admin/` uses `adminRoute` or `transitionRoute`, which wraps `adminRoute`.
  - Edge and app limits are as in ADR-0004.
- **Client IP:**
  - Trusted only on Vercel (`VERCEL=1`).
  - IPv6 is counted per /64.
  - The enumeration detector keys an HMAC of the subject, keeps only 0.1° tiles in memory, caps tracked clients at 5,000, and never logs an IP or a coordinate.
- **Sentry (4.4):**
  - Every `dataCollection` category is off.
  - `includeLocalVariables` is unset (the local-variables integration stays off).
  - Postgres `DETAIL` (which contains rows) isn't attached: the default integrations add error properties only for Node system errors.
  - `beforeSend` drops `user` and `server_name` and keeps URL paths only.
  - The tunnel strips IP and client-hint headers: verified on the preview.
- **GA4 (4.1):**
  - Consent comes first.
  - Every event has a parameter allowlist, plus a second guard on key and value patterns.
  - `page_location` is sanitised.
  - `Referrer-Policy: strict-origin-when-cross-origin`, so Mapbox and Google receive only the origin.
- **Secrets:**
  - `pnpm check:client-bundle` runs in CI.
  - Only a `pk.` Mapbox token is accepted in the browser.
  - `SENTRY_AUTH_TOKEN` is in Vercel only.
- **CI and supply chain:**
  - Every action is pinned by SHA.
  - Top-level `permissions: contents: read`.
  - No `pull_request_target`.
  - `codex-autofix` runs only for the Codex bot, on same-repo open PRs, with a validated branch name and a tool allowlist.
  - Production deploys are `workflow_dispatch` plus an environment approval.
  - gitleaks runs over the full history.
- **Dependencies:**
  - `pnpm audit` (all dependencies): no known vulnerabilities.
  - `allowBuilds` lets only `sharp` run an install script.
  - New in this PR: `@lhci/cli` 0.16.1 (dev only, Apache-2.0, released 2026-11-11), approved by Hugh.

## Not reviewed

- Production infrastructure (4.6): the Supabase prod project, DNS, the Mapbox URL restriction, the GA4 property.
- The live Vercel Firewall beyond its export file. Bot Protection is still `log`: switch it to `challenge` after a week of clean logs (`edge-rules.md`).
- Supabase hosted-project settings: network restrictions, backups, role passwords.
- Admin credential handling on the operator's machine.
- The six open Dependabot PRs (#87–#92), including supabase 3 and postgres 4.
- Penetration testing, and third-party code (Mapbox GL, gtag.js) beyond the CSP allowlist.

## Performance (Lighthouse)

`pnpm perf` (`lighthouserc.json`, CI job `perf`) builds against the local seeded database with the real Mapbox library and a placeholder Sentry DSN. It runs Lighthouse mobile three times per URL, with **DevTools throttling**: 150 ms RTT, 1.6 Mbps, 4× CPU slowdown. That applies real network and CPU throttling to a slow 4G connection. Medians, after this PR's fixes:

| Page                                             | LCP    | TBT    | CLS | JS transferred |
| ------------------------------------------------ | ------ | ------ | --- | -------------- |
| `/`                                              | 1.62 s | 927 ms | 0   | 797,533 B      |
| `/venues/ironbark-park` (photos)                 | 1.71 s | 279 ms | 0   | 259,522 B      |
| `/venues/ironbark-park/pitches/pitch-a` (photos) | 1.71 s | 279 ms | 0   | 259,522 B      |
| `/venues/far-plains-oval` (no photos)            | 1.54 s | 278 ms | 0   | 259,522 B      |

**Budgets (enforced):**

- **Detail pages:** LCP ≤ 2,500 ms.
- **`/`:** script transfer ≤ 877,000 B, which is the measured 797,533 B + 10% (Hugh's choice).
- Lowering either budget below the measured value makes `lhci assert` fail, so the gate works.

**Simulated vs applied throttling:**

- Lighthouse's default _simulated_ throttling estimates about **2.97–3.23 s** LCP for the photo pages, over the 2.5 s budget.
- The unthrottled breakdown shows TTFB 27 ms, resource load delay 40 ms, load 31 ms and render delay 63 ms. The photo is preloaded and discoverable.
- The gap is the simulator's estimate for a second origin (the media host) sharing simulated bandwidth with about 260 KB of JS, not what the page does under applied throttling.
- We gate on DevTools throttling and record the simulated figure here. Real-user LCP from production (Vercel Speed Insights or CrUX, after 4.6) should settle which one is right.

**Changes in this PR:**

- **Sentry loads lazily** (Hugh's choice). It's in its own chunk, about 57 KB gzipped, fetched once the page has loaded and gone idle (`src/lib/observability/lazy-browser.ts`). Errors from before then are buffered (up to 10) and sent once the SDK starts: verified in a browser through `/monitoring`. A first attempt that imported the whole `@sentry/nextjs` package produced a 159 KB chunk. `browser-sdk.ts` re-exports only `init` and `captureException`.
- **First gallery photo:** it now has `fetchpriority="high"`, on the `<img>` and its preload.

**Follow-ups (not blocking):**

- **`/` total blocking time** is 927 ms. Most of it is Mapbox GL (about 520 KB gzipped, 1.9 MB raw), which is already its own chunk. Options: load it after first paint, or only once the map is visible on mobile.
- **Photo sizes:** upload-time 640/1280/2560 copies for `srcset` (from 3.12) would cut photo bytes on mobile. The fixture photos are small (16–18 KB), so this run understates real photos.
