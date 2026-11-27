# Production setup (PR 4.6)

This runbook covers setting up production for the first time: a production Supabase project, the `deploy` workflow migrating it after approval, and Vercel Production moved off the staging database. Hugh does every step, because each one needs his accounts. Claude never sees the values.

The order matters. Until step 5, production keeps serving from staging. After step 5 it serves from its own, empty database.

**Decisions (2026-11-27, Hugh):**

- Supabase **Free** for now. That means no backups, and the project pauses after a week without activity. Upgrade to Pro before entering real data, and before launch.
- No custom domain yet. The production host is `https://fieldfinder-sooty.vercel.app`, and `SITE_URL` stays unset.
- Migrations run inside `deploy.yml`, after approval, between the build and the deploy.

## 1. Create the Supabase project

1. Create a new project in the Supabase dashboard:
   - **Name:** `fieldfinder-prod`.
   - **Region:** `ap-southeast-2` (Sydney), next to the Vercel functions in `syd1`.
   - **Database password:** generate a long one and save it straight into your password manager. This is the owner password (`postgres`). It goes only into the GitHub secret in step 2 and into `DATABASE_URL_OPERATOR` on your own machine.
2. Leave the Data API as it is. The migrations revoke everything from `anon`, `authenticated` and `service_role` (migration 0003), so it exposes nothing.

## 2. Add the migration secret to GitHub

GitHub → repo Settings → Environments → `production` → add a secret:

- **`SUPABASE_DB_URL_MIGRATE`:** the **session pooler** connection string, from Connect → Session pooler. It has this shape:
  `postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`
  - Percent-encode the password if it has symbols.
  - Use the session pooler, not the direct connection. The direct connection is IPv6-only, and GitHub runners have no IPv6.
  - Use port 5432 (session), not 6543 (transaction). Migrations run DDL in sessions.

Also check that `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are set in the same environment, and that `production` has you as a required reviewer.

**Optional rehearsal on your machine**, before the first real run. This session isn't allowed to run `supabase db push`. Docker and `pnpm db:start` must be running first.

```sh
docker exec supabase_db_fieldfinder psql -U postgres -c "create database ff_pushtest"
pnpm exec supabase db push --db-url postgresql://postgres:postgres@127.0.0.1:54322/ff_pushtest --skip-vault --dry-run --yes   # lists 0001–0007
pnpm exec supabase db push --db-url postgresql://postgres:postgres@127.0.0.1:54322/ff_pushtest --skip-vault --yes
pnpm exec supabase db push --db-url postgresql://postgres:postgres@127.0.0.1:54322/ff_pushtest --skip-vault --dry-run --yes   # "up to date"
docker exec supabase_db_fieldfinder psql -U postgres -c "drop database ff_pushtest"
```

## 3. First run of the deploy workflow (migrates the database)

1. Actions → `deploy` → Run workflow, on `main`. Approve the `production` environment when asked.
2. The run's summary has a **Migrations** block. On this first run it should list `0001_core.sql` to `0007_media_buckets.sql`. The seed (`supabase/seed.sql`) is never applied: it's synthetic data for local and staging only.
3. This deploy still uses the staging values in Vercel Production. That's expected, because the same code is now deployed against the same staging database.

If the migration step fails, nothing was deployed. Read the error, fix it forward with a new migration in a PR (never edit a merged migration), and run the workflow again.

## 4. Turn on the app roles and create Storage keys

In the production project's SQL editor, set each role's password. Generate each one with `openssl rand -base64 32 | tr -d '/+='` and save it in your password manager.

```sql
alter role ff_public_reader login password '<reader password>';
alter role ff_admin_writer login password '<writer password>';
```

Then, under Storage → S3 connection, create a new access key pair. The `media-public` and `media-private` buckets already exist (migration 0007).

## 5. Point Vercel Production at production

In Vercel → Project → Settings → Environment Variables, edit the **Production** entries only. Preview keeps staging. Mark every secret as Sensitive. Never reuse a Preview value for a secret.

| Variable                                           | Production value                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL_PUBLIC_READER`                       | `postgresql://ff_public_reader.<ref>:<reader password>@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`. Transaction pooler, as staging uses. |
| `DATABASE_URL_ADMIN_WRITER`                        | The same shape, with `ff_admin_writer` and its password                                                                                              |
| `SEARCH_CURSOR_SECRET`                             | A new value: `openssl rand -base64 48`                                                                                                               |
| `SUPABASE_S3_ENDPOINT`                             | `https://<ref>.storage.supabase.co/storage/v1/s3`                                                                                                    |
| `SUPABASE_S3_REGION`                               | `ap-southeast-2`                                                                                                                                     |
| `SUPABASE_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | The key pair from step 4                                                                                                                             |
| `MEDIA_PUBLIC_BASE_URL`                            | `https://<ref>.supabase.co/storage/v1/object/public/media-public`                                                                                    |
| `NEXT_PUBLIC_MAPBOX_TOKEN`                         | A new **public** (`pk.`) token, URL-restricted to `https://fieldfinder-sooty.vercel.app`, with default public scopes only                            |
| `MAPBOX_GEOCODING_TOKEN`                           | A production token for the server's geocoding calls, separate from Preview's                                                                         |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`                    | The production GA4 property's web stream ID. Google signals and ad personalisation off; data retention 14 months or less                             |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_*`               | Already set (4.4). Leave as is                                                                                                                       |
| `SITE_URL`                                         | Leave unset until there's a custom domain                                                                                                            |

Then run the `deploy` workflow again. `NEXT_PUBLIC_*` values and the CSP's `img-src` (from `MEDIA_PUBLIC_BASE_URL`) are fixed at build time, so a rebuild is needed, not just a restart. The Migrations block should now show nothing to apply.

## 6. Check production

```sh
HOST=https://fieldfinder-sooty.vercel.app
curl -sS -o /dev/null -w "%{http_code}\n" "$HOST/"                                  # 200
curl -sS "$HOST/api/venues?lat=-37.8136&lng=144.9631" | head -c 300; echo          # 200 with "items":[]: the new empty database, not staging's seed
curl -sSI "$HOST/" | grep -i '^content-security-policy:' | grep -o "https://[a-z0-9]*\.supabase\.co" | sort -u   # only the production <ref>
curl -sS "$HOST/robots.txt"                                                         # allows crawling, disallows /api/
curl -sS -o /dev/null -w "%{http_code}\n" "$HOST/sitemap.xml"                        # 200
```

Then:

- **Firewall:** run the "Check after publishing" loop in `docs/security/edge-rules.md`.
- **Staging smoke:** this is the 4.6 acceptance test. Run `FF_ADMIN_TOKEN=… pnpm security:smoke <current preview URL>` with a one-day staging token, as described in `scripts/security-smoke.ts`, then revoke the token.
- **Revoke staging access from production:** once production is confirmed on its own database, nothing in Vercel Production should mention the staging `<ref>`.

## 7. Admin access and data

- Mint the production admin credential from your machine, with `DATABASE_URL_OPERATOR` set to the production owner URL (session pooler) in your shell only:
  `pnpm admin:credential mint --label hugh-prod-2026-11 --scopes <scopes you need> --days 90`.
  Store the token in your password manager.
- **Production starts empty.** Search shows no venues until real venues, pitches and photos are entered through the admin API (`docs/api/admin-operations.md`). Rights evidence is required before a photo can be published. Never run `seed.sql`, `pnpm media:upload-fixtures` or `pnpm media:smoke` against production.

## 8. Before launch (still open)

- [ ] **Supabase Pro** before real data, so there are daily backups. On Free, take a manual backup before every migration run. The default `db dump` is schema only (no data, no custom roles), so take all three, each to a file outside the repo:
  - roles: `pnpm exec supabase db dump --db-url "$DATABASE_URL_OPERATOR" --role-only -f <dir>/roles.sql`
  - schema: `pnpm exec supabase db dump --db-url "$DATABASE_URL_OPERATOR" -f <dir>/schema.sql`
  - data: `pnpm exec supabase db dump --db-url "$DATABASE_URL_OPERATOR" --data-only --use-copy -f <dir>/data.sql`
  - Restore in that order (roles, schema, data). The data file holds admin credential hashes and audit history, so keep all three in encrypted storage, never in git or a CI artifact.
- [ ] `/privacy` and `/terms`: replace `[operator name]` and `[contact email]`, and have the wording reviewed (P5).
- [ ] Custom domain: DNS, `SITE_URL`, the Mapbox token's URL restriction, and the HSTS `preload` decision (review-m4.md, L4).
- [ ] Bot Protection from `log` to `challenge` after a week of clean logs (`edge-rules.md`).
- [ ] 4.7: post-deploy smoke tests in `deploy.yml`, plus the rollback, incident and migration runbooks.
