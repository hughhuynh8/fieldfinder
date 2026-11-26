import { createTunnelHandler } from "@/lib/observability/tunnel";

// Sentry tunnel (PR 4.4). next.config.ts rewrites the public /monitoring path here. See
// src/lib/observability/tunnel.ts for what is and isn't forwarded.
export const POST = createTunnelHandler(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined);
