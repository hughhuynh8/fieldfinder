import { config } from "zod";

// Zod 4 tests whether it may compile validators with `new Function` by calling `Function("")` once.
// Under our CSP (no 'unsafe-eval', PR 4.5) that call is blocked, so Zod falls back anyway, but the
// browser logs a CSP violation on every page. Telling Zod up front to stay jitless skips the test.
// Browser only: imported from src/instrumentation-client.ts, before any schema is used. The server
// has no CSP and keeps the faster compiled validators.

config({ jitless: true });
