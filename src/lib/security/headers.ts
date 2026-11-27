// Baseline security headers applied to every route (see next.config.ts).
// CSP is enforced (PR 4.5, Hugh's choice): the allowlist below blocks scripts from other origins,
// framing, plugins and requests to hosts not listed. script-src still allows 'unsafe-inline' for
// Next's inline bootstrap scripts; replacing it with per-request nonces is a follow-up, because
// nonces make every page dynamic (docs/security/review-m4.md).
//
// Images (PR 3.3): venue photos come from the public media bucket, so its origin (scheme + host from
// MEDIA_PUBLIC_BASE_URL, never the path) is allowed in img-src. A missing or malformed value adds
// nothing. Read here rather than via src/lib/env.ts, which is server-only and can't load in
// next.config.ts; the value isn't secret.
//
// Map (PR 3.4): mapbox-gl fetches styles, tiles and fonts from api.mapbox.com and *.tiles.mapbox.com,
// reports map loads (its billing) to events.mapbox.com, and runs its worker from a blob: URL.
//
// Analytics (PR 4.1): after consent, gtag.js loads from www.googletagmanager.com and sends hits to
// GA4's collection hosts (Google's documented CSP for GA4: fetch/beacon, with an image fallback).
// Loaded as a script element by our own code, so no inline script needs allowing for it.

const GA_SCRIPT = "https://www.googletagmanager.com";
const GA_CONNECT = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://www.googletagmanager.com",
].join(" ");
const GA_IMG = "https://*.google-analytics.com https://www.googletagmanager.com";

/** The http(s) origin of `value`, or null if it isn't a usable URL. */
export function mediaOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^https?:\/\//.test(trimmed) || !URL.canParse(trimmed)) return null;
  return new URL(trimmed).origin;
}

// Vercel Toolbar (PR 4.5): Vercel injects it into PREVIEW deployments only (comments, feedback). Its
// origins are added when the build runs with VERCEL_ENV=preview, never for production or local
// builds. Source: Vercel's toolbar CSP guidance.
const TOOLBAR = {
  script: "https://vercel.live",
  style: "https://vercel.live",
  img: "https://vercel.live https://vercel.com",
  font: "https://vercel.live https://assets.vercel.com",
  connect: "https://vercel.live wss://ws-us3.pusher.com",
  frame: "https://vercel.live",
};

function contentSecurityPolicy(media: string | null, preview: boolean): string {
  const toolbar = (key: keyof typeof TOOLBAR) => (preview ? TOOLBAR[key] : null);
  const directive = (...parts: (string | null)[]) => parts.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    directive("script-src 'self' 'unsafe-inline'", GA_SCRIPT, toolbar("script")),
    directive("style-src 'self' 'unsafe-inline'", toolbar("style")),
    directive("img-src 'self' data: blob:", media, GA_IMG, toolbar("img")),
    directive("font-src 'self'", toolbar("font")),
    directive(
      "connect-src 'self' https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com",
      GA_CONNECT,
      toolbar("connect"),
    ),
    "worker-src 'self' blob:",
    "child-src blob:",
    ...(preview ? [`frame-src ${TOOLBAR.frame}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export type SecurityHeader = { key: string; value: string };

export function buildSecurityHeaders(env: Record<string, string | undefined> = process.env): SecurityHeader[] {
  return [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(mediaOrigin(env.MEDIA_PUBLIC_BASE_URL), env.VERCEL_ENV === "preview"),
    },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
}

/** The headers for this process's environment (next.config.ts reads them at build time). */
export const securityHeaders: SecurityHeader[] = buildSecurityHeaders();
