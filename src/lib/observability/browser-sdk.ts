// The parts of the Sentry browser SDK that lazy-browser.ts loads (PR 4.5). Named imports, not
// `import("@sentry/nextjs")`: a dynamic import of the whole package can't be tree-shaken, and that
// chunk came out about 160 KB gzipped against about 57 KB for these two functions.

export { captureException, init } from "@sentry/nextjs";
