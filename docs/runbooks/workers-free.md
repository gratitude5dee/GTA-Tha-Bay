# Runbook: tha-bay-web on Workers Free (DL-OWN-08)

Scope: the operator steps that keep `tha-bay-web` and `tha-bay-web-staging` inside the Workers Free limits (DL-744, `spec/domains/09-backend-ops.md` §1.4; the limits are in `spec/03-decisions-and-facts-2.md` §8: 5 Cron Triggers per account, 10 ms CPU per request, cron invocation and Workflow step, 100,000 Worker requests a day). Every step here is an **operator** step, not a Builder or CI action.

## 1. One dispatcher cron per Worker (BD-FIX-CRON-01)

`services/edge/wrangler.jsonc` declares a single Cron Trigger, `*/5 * * * *`, for each Worker (2 for the account, not 8). The scheduled handler (`services/edge/src/ops/scheduled.ts`) reads the tick's `scheduledTime`, not its expression, and runs the `SCHEDULE` row of that UTC minute:

| UTC | Jobs, in order |
|---|---|
| 03:10 | `catalog-sync`, `ledger-export`, `transcripts` |
| 03:20 | `memory` |
| 03:30 | `stub-profiles` |
| 03:40 | `builder-drafts` |

Every other tick returns at once, with no I/O and no log line. A new scheduled job is a row in `SCHEDULE`, never a new expression.

### Applying the trigger (operator, once per Worker)

No CI step applies a cron change today. `deploy.yml` runs `pnpm deploy:prod`, whose normal path is `wrangler versions upload` then `versions deploy`; `versions upload` does not apply triggers and says so ("Changes to triggers (routes, custom domains, cron schedules, etc) must be applied with the command wrangler triggers deploy", wrangler 4.151.1). Only `wrangler deploy` applies them (it replaces the Worker's whole schedule list), and the repo runs it in two places only: `pnpm deploy:bootstrap` (operator, first deploy) and the Durable Object lifecycle path of `deploy:prod` (a `do-lifecycle` change). Until the operator acts, both Workers keep the four daily expressions; that is safe, because the dispatcher picks jobs by time, so `10 3 * * *` still runs the 03:10 row, and so on. It still counts 8 schedules against 5.

After the commit that carries BD-FIX-CRON-01 is deployed to a Worker (the handler must be the dispatcher before its trigger changes), from the repository root of that commit, after `pnpm build` (wrangler checks that `apps/web/dist` exists), with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the shell:

```bash
pnpm --filter @dv/edge exec wrangler triggers deploy --env staging --dry-run   # validates the config, needs no token, calls nothing
pnpm --filter @dv/edge exec wrangler triggers deploy --env staging            # tha-bay-web-staging: schedules become ["*/5 * * * *"]
pnpm --filter @dv/edge exec wrangler triggers deploy --env=""                 # tha-bay-web (production, the top-level config)
```

`triggers deploy` puts the config's schedule list in place of the Worker's (the four daily expressions go). Then on the dashboard confirm that each Worker lists exactly one Cron Trigger, `*/5 * * * *`. The next 03:10 UTC tick logs one `cron.done` line with `"slot":"03:10"`; the 03:20, 03:30 and 03:40 ticks one each.

To run a tick by hand on staging or a Preview (no Cron Triggers there): `POST /api/v1/_test/run-scheduled?at=03:10` runs that minute's row; `?job=<name>` runs one job.

## 2. Q-45 check (operator, now)

(a) On the Cloudflare dashboard confirm the account plan and its Cron Trigger count: after section 1, 2 (one per Worker); before it, 8. (b) For both Workers, over the last 3 days, read "Exceeded CPU Time Limits" and the daily request count. A CPU count above 0 is a RISK-31 trigger (name the handler or cron in the report: the cron's `cron.done` lines carry the slot); requests above 70,000 a day are a RISK-32 trigger. Report what you read to the Architect, who records it under Q-45 (`spec/99-open-questions-2.md`, from the Free-plan amendment, DL-744 and DL-749).

## 3. CPU of the cron jobs (BD-FIX-CRON-01 review)

Each job is I/O-bound (DataPort calls to Supabase, R2 list and delete, Durable Object RPC); none hashes, transcodes or parses a large body. What could pass 10 ms on a large day, in the order to look at if (b) shows a cron over the limit:

- 03:10 runs three jobs in one invocation. `ledger-export` reads up to 20 pages of 500 ledger rows and serialises each page twice (DO RPC, PostgREST body); a backlog of thousands of rows is the most CPU in the cron. `transcripts` deletes up to 20 rounds of 500 rows and filters every `exports/` key with a regex. Remedy: move `transcripts` (and if needed `ledger-export`) to its own minute in `SCHEDULE` (for example 03:15) and lower `MAX_PAGES`/`MAX_ROUNDS`.
- 03:30 `stub-profiles` runs the forget steps for up to 1,000 profiles (each a few DataPort calls and R2 list/delete pages); a first run after months of idle profiles is the large case. Remedy: lower `BATCH`; the next day continues.
- 03:20 `memory` is one RPC; 03:40 `builder-drafts` at most 2,000 drafts in pages of 100. `catalog-sync` upserts the shipped index (10 KB today).
