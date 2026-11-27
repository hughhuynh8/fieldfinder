// Prepares the LOCAL database for `pnpm perf` (PR 4.5): throwaway logins for the app roles and the
// fixture photos in local Storage, exactly as the database E2E specs get them (tests/e2e/global-setup.ts,
// which refuses any non-local host). Run after `pnpm db:start`.

import globalSetup from "../tests/e2e/global-setup.ts";

process.env.E2E_DB = "1";
await globalSetup();
process.stdout.write("Local database ready for Lighthouse.\n");
