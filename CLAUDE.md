# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted webmail for your own domain on the Cloudflare Workers **Free** plan: Cloudflare Email Routing receives mail, Amazon SES sends it, a static Vue dashboard reads it. Derived from [Email Explorer](https://github.com/G4brym/email-explorer) (MIT, original LICENSE kept); the SES sending path, `deploy/`, and these docs are what this repository adds.

## Commands

pnpm workspace: `packages/worker` (npm name `email-explorer`), `packages/dashboard`, `packages/worker/dev`.

```bash
pnpm install
pnpm lint              # biome check; on failure it rewrites files with --write and still exits 1
pnpm build-dashboard   # vue-tsc type-check + vite build -> packages/dashboard/dist
pnpm build             # dashboard, then tsup for the worker (also copies dashboard dist into packages/worker/dashboard)
cd packages/worker && pnpm test   # tsc, then vitest inside workerd (@cloudflare/vitest-pool-workers)
cd packages/worker && npx vitest run --config tests/vitest.config.mts tests/unit/ses-utils.test.ts   # one file
cd packages/worker && npx vitest run --config tests/vitest.config.mts -t "puts every recipient"      # one test by name
bash deploy/deploy.sh  # install, build, test, deploy
```

CI (`.github/workflows/build.yml`) runs lint, `pnpm build`, then the worker tests. The test config loads `packages/worker/dev/wrangler.jsonc`, whose assets directory is the dashboard copy that build produces, so build before testing.

Build on Linux, macOS or WSL: the worker's build script uses `cp -R`, which cmd.exe lacks. Run shell scripts as files (`bash deploy/deploy.sh`), not piped into `bash`: a build step reads stdin and will swallow the rest of a piped script, and bash then exits 0 having skipped the tests and the deploy.

## Architecture

**One Worker, two entry points.** `EmailExplorer(options)` in `packages/worker/src/index.ts` returns `{ email, fetch }`; `deploy/index.ts` calls it and re-exports `MailboxDO`.

- `email` → `receiveEmail`: postal-mime parse; the mailbox id is the first `To` address; attachments go to R2 at `attachments/<emailId>/<attachmentId>/<filename>`; `mailboxes/<address>.json` is created in R2 if missing — that object existing is what makes a mailbox exist. There is no allow-list, so every address routed to the Worker becomes a mailbox. Route specific addresses and keep the Email Routing catch-all off.
- `fetch`: Hono + chanfana OpenAPI routes under `/api/v1/*`. Everything else is the Vue SPA served from Workers static assets (`run_worker_first: ["/api/*", "/docs", "/openapi.json"]`), so page loads cost no Worker CPU — the reason this fits the Free plan's 10 ms CPU limit.

**`MailboxDO` is used two ways.** `idFromName(<mailbox address>)` holds that mailbox's emails, folders, contacts and attachment metadata; `idFromName("AUTH")` holds users, sessions and mailbox access grants. SQLite via workers-qb, migrations in `durableObject/migrations.ts`. Passwords are a single SHA-256 digest (`#hashPassword`).

**Auth runs in `fetch` before routing.** `isPublicRoute` (register, login, forgot/reset password, settings, docs) skips it; everything else validates the session cookie against the AUTH DO, and non-admins are checked against their grants for the `:mailboxId` param. Smart mode (default): the first registered user becomes admin and registration closes.

**Outbound mail all goes through `sendOutboundEmail` (`src/outbound.ts`)** — send, reply, forward and password recovery.
- `EMAIL_PROVIDER=ses`: SES API v2 `SendEmail` with Simple content, signed by aws4fetch with `retries: 0` (a retried send SES already accepted would deliver twice). SES builds the MIME; request shaping is in `src/ses-utils.ts`, pure and unit-tested in `tests/unit/`. `In-Reply-To`/`References` are trimmed to SES's limits (value ≤ 995 chars, name + value ≤ 996), keeping the root ID plus the newest.
- Otherwise the upstream path: `mime-builder.ts` + the `send_email` binding, which takes a single envelope recipient.
- SES replaces the Message-ID header. The sent row's `id` is `<SES MessageId>@<region>.amazonses.com` (`email.amazonses.com` in us-east-1, override with `AWS_SES_MESSAGE_ID_DOMAIN`), stored bare like the IDs `receiveEmail` reads from replies, so a reply's `thread_id` — first `References` entry, else `In-Reply-To` — matches the sent message.
- The routes' zod-inferred attachment types mark every field optional; `sendOutboundEmail` accepts `Partial` attachments and fills defaults. Passing them to a stricter type fails `tsc` and the tsup DTS build.
- Known gap: inbound rows get random UUID ids, so a reply's `In-Reply-To` names that UUID rather than the original Message-ID, and other mail clients may not thread it.

**Dashboard** (`packages/dashboard`): Vue 3, one Pinia store per resource in `stores/`, all HTTP through `services/api.ts`; routes are `/login`, `/register`, `/admin` and `/mailbox/:mailboxId/{emails/:folder, email/:id, contacts, settings, search}`.

**Deployment config.** `deploy/wrangler.jsonc` is the real deployment: Worker `email-explorer`, R2 bucket `email-explorer`, DO class `MailboxDO`, and the `send_email` binding kept for the non-SES path. `packages/worker/dev/` exists for the tests; don't deploy from it. Worker secrets: `EMAIL_PROVIDER`, `AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_SES_CONFIGURATION_SET` and `AWS_SES_MESSAGE_ID_DOMAIN`. Email Routing rules name the Worker, so renaming it means updating those rules.

## Conventions

Biome: tabs, double quotes, `noExplicitAny` off. Types shared across the worker live in `src/types.ts`; `Env` there lists bindings and the SES variables.
