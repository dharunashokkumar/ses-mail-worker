# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted webmail for your own domain on the Cloudflare Workers **Free** plan: Cloudflare Email Routing receives mail, Amazon SES sends it, a static Vue dashboard reads it. Derived from [Email Explorer](https://github.com/G4brym/email-explorer) (MIT, original LICENSE kept); the SES sending path, the mail engine in the Durable Object, the current dashboard, `deploy/` and these docs are what this repository adds.

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

To look at the app locally: `pnpm build-dashboard`, copy `packages/dashboard/dist` to `packages/worker/dashboard`, then `cd packages/worker/dev && npx wrangler dev`. Replacing that directory while Wrangler is running invalidates its asset manifest (every page 500s) — restart it after a rebuild.

Build on Linux, macOS or WSL: the worker's build script uses `cp -R`, which cmd.exe lacks. Run shell scripts as files (`bash deploy/deploy.sh`), not piped into `bash`: a build step reads stdin and will swallow the rest of a piped script, and bash then exits 0 having skipped the tests and the deploy.

## Architecture

**One Worker, two entry points.** `EmailExplorer(options)` in `packages/worker/src/index.ts` returns `{ email, fetch }`; `deploy/index.ts` calls it and re-exports `MailboxDO`.

- `email` → `receiveEmail`: reads the raw bytes, finds the recipient (`event.to`, else a regex over the header block) and hands the bytes to `MailboxDO.ingestRaw`. **No MIME parsing in the Worker** — that is what keeps inbound mail inside the 10 ms CPU limit. `mailboxes/<address>.json` is created in R2 if missing; that object existing is what makes a mailbox exist. There is no allow-list, so every address routed to the Worker becomes a mailbox. Route specific addresses and keep the Email Routing catch-all off.
- `fetch`: Hono. The original chanfana OpenAPI routes remain under `/api/v1/*`; the dashboard's own API is registered by `registerMailRoutes` (`src/routes/mail.ts`) as plain Hono handlers — they only validate input and call the Durable Object. Everything else is the Vue SPA served from Workers static assets (`run_worker_first: ["/api/*", "/docs", "/openapi.json"]`), so page loads cost no Worker CPU.

**`MailboxDO` is used two ways.** `idFromName(<mailbox address>)` holds that mailbox's mail; `idFromName("AUTH")` holds users, sessions and mailbox access grants. SQLite via workers-qb, migrations in `durableObject/migrations.ts` (never edit an applied migration — add the next one). Passwords are a single SHA-256 digest (`#hashPassword`).

**The mail engine lives in the Durable Object** (`durableObject/index.ts`), which gets 30 s of CPU per request:
- `ingestRaw` parses with postal-mime, stores the real Message-ID as the row id (so replies from other clients thread), writes a preview, categorises, scores spam from `Authentication-Results` plus the blocklist, applies rules, collects contacts, puts attachments in R2, and indexes the text in FTS5. Bodies over 96 KB go to R2 (`body_key`) with the text still indexed.
- `listThreads` groups on `COALESCE(thread_id, id)`; conversations can be switched off. A list row names the correspondent, not you, when your own reply is newest.
- Search: `mail/search-query.ts` parses `from: to: subject: label: category: in: has: is: before: after: on:` and quoted phrases into FTS5 MATCH plus SQL predicates.
- Alarms handle snooze, scheduled send and follow-up reminders — not cron, which the free plan limits to five triggers.
- Hibernatable WebSockets (`fetch` upgrade, `#broadcast`) tell open clients to refetch; they never carry mail.
- Workers AI (`@cf/meta/llama-3.2-3b-instruct`) for summaries, quick replies and rewrite, with a per-day neuron count in `settings` so it stops before the free tier errors.

The pure helpers it uses are unit-tested without a runtime: `src/mail/{text,classify,rules,search-query}.ts`.

**Outbound mail all goes through `sendOutboundEmail` (`src/outbound.ts`)** — send, reply, forward, scheduled send and password recovery.
- `EMAIL_PROVIDER=ses`: SES API v2 `SendEmail` with Simple content, signed by aws4fetch with `retries: 0` (a retried send SES already accepted would deliver twice). SES builds the MIME; request shaping is in `src/ses-utils.ts`, pure and unit-tested. `In-Reply-To`/`References` are trimmed to SES's limits (value ≤ 995 chars, name + value ≤ 996), keeping the root ID plus the newest.
- Otherwise the upstream path: `mime-builder.ts` + the `send_email` binding, which takes a single envelope recipient.
- SES replaces the Message-ID header. The sent row's `id` is `<SES MessageId>@<region>.amazonses.com` (`email.amazonses.com` in us-east-1, override with `AWS_SES_MESSAGE_ID_DOMAIN`), stored bare like the IDs `ingestRaw` reads from replies.
- SNS delivery notifications land on `/api/v1/webhooks/ses?token=…` (public, guarded by `SES_WEBHOOK_TOKEN`) and update `delivery_state` on the sent row.
- The routes' zod-inferred attachment types mark every field optional; `sendOutboundEmail` accepts `Partial` attachments and fills defaults. Passing them to a stricter type fails `tsc` and the tsup DTS build.

**Auth runs in `fetch` before routing.** `isPublicRoute` (register, login, forgot/reset password, settings, webhooks, docs) skips it. With `AUTH_MODE=access` the Worker verifies the Cloudflare Access JWT (`src/access.ts`, JWKS cached per isolate) and builds the session from it; otherwise it validates the session cookie against the AUTH DO and checks non-admins against their grants for the `:mailboxId` param.

**Dashboard** (`packages/dashboard`): Vue 3 with three Pinia stores — `mail` (scope, threads, open conversation, counts, labels, live socket, offline cache), `compose` (composer windows, drafts, undo send, outbox) and `prefs` (theme, accent, density, pane, swipe actions, mirrored to the mailbox's server-side preferences). All HTTP goes through `services/mail.ts`. The interface is `views/MailView.vue` plus `components/mail/*`; styling is CSS custom properties in `assets/main.css` (light base, dark redefined for both the system preference and an explicit choice), not Tailwind utilities. Routes: `/mail/:mailboxId?/:folder?` with `?thread=`, the old `/mailbox/...` paths redirect. `public/sw.js` caches the shell and API reads for offline use.

**Deployment config.** `deploy/wrangler.jsonc` is the real deployment: Worker `email-explorer`, R2 bucket `email-explorer`, DO class `MailboxDO`, the AI binding, and the `send_email` binding kept for the non-SES path. `packages/worker/dev/` exists for the tests; don't deploy from it. Worker secrets: `EMAIL_PROVIDER`, `AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_SES_CONFIGURATION_SET`, `AWS_SES_MESSAGE_ID_DOMAIN`, `AUTH_MODE`/`ACCESS_AUD`/`ACCESS_TEAM_DOMAIN`, `SES_WEBHOOK_TOKEN`, and `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`/`MAIL_DOMAIN`. Email Routing rules name the Worker, so renaming it means updating those rules.

## Conventions

Biome: tabs, double quotes, `noExplicitAny` off. Types shared across the worker live in `src/types.ts`; `Env` there lists bindings and the optional variables. Hono infers a route type per handler, and a file with this many routes exceeds TypeScript's instantiation depth — `src/routes/mail.ts` takes the app as `Hono<any, any, any>` and declares its own `MailboxStub` interface instead of using the Durable Object's inferred RPC type.

Every feature has to fit the Free plan: 10 ms Worker CPU per request, 100k requests/day, 5 GB of Durable Object storage, 10 GB in R2, 10,000 Workers AI neurons a day. When something needs more CPU than that, it belongs in the Durable Object (30 s) or in the browser.
