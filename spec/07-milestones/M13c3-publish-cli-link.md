# M13c3 — publish-cli-link

## Goal
A creator, or their coding agent, can publish from the terminal with a human in the loop. `dv login` runs the RFC 8628 device-code flow against route 10 and stores the token in a mode-0600 file. `dv mod publish` refuses to run without a TTY. It runs `check` and `pack`, shows the declarations, and records the human's confirmation as `PublishAttestation`. It then uploads the archive (route 34) and registers the version (route 36), and reports the moderation state. `--dry-run` proves the whole path on a host without writing anything. The `thabay-mcp` tool `mod.publish` only hands the command to the human. In the browser, the `openai` identity adapter (behind `auth.openaiWeb`) and the static `/account/callback` page complete C12 route 11, so `/link` can raise a profile to `linked` once OpenAI grants a client. A staging suite proves a `linked` profile can approve a code and publish.

## Requirements
- R-MOD-01: the agent-friendly kit gains its last step, publishing, with the human confirmation the kit's `AGENTS.md` promises.
- R-MOD-02: the device-code publish login and the flagged website ChatGPT link (`12-modding-publish.md` C§2 flows A and C).
- R-AUTH-03: ChatGPT linkage is optional, flagged and used only for publishing.

## Depends on
- **M13c2**: route 36 (CLI token accepted), the scan pipeline, version states, route 35 detail with state.
- **M13a6**: `@dv/cli` groups, `--json` output, `thabay-mcp`, `check:mods` (`dv --help` smoke of every group), `check:skills`, the kit `AGENTS.md`.
- Contracts: C14 1.0.0 (`ModVersionsReq`/`Res`, `PublishAttestation`, `ModDeclarations`, `ModErrorCode`), C12 1.1.0 (routes 8–11, 34, 35, 36; `TokenRes`, `UploadReq`/`Res`, `IdentityService.link`, `ProviderId`).
- Decision records: ADR-0018, ADR-0019, DL-148 (flow B only after an ADR), DL-189, DL-192 (CI staff profile).

## Scope in
- `tools/cli/src/publish/login.ts`: `dv login [--host <url>]` and `dv logout`.
  - Login posts route 10 and prints `user_code` and `verification_uri` (`--json`: `{user_code, verification_uri, expires_in}`). It polls at `interval`, adds 5 s on every `slow_down`, and stops on `access_denied` or `expired_token` with a JSON error and a `fix`.
  - Tokens go to `<config dir>/dv/credentials.json` with mode 0600, created atomically. An OS keychain is used only if the library pnpm resolves works on the platform. The file is always the fallback.
  - `dv logout` deletes the file and best-effort revokes through route 9. The token is never printed or logged.
- `tools/cli/src/publish/client.ts`: an HTTP client with `X-Client-Build`. On a 401 it refreshes once through route 8 (`grant: refresh`), then retries once. It sends an `Idempotency-Key` (UUIDv7, minted in the CLI) on every write.
- `tools/cli/src/publish/publish.ts`: `dv mod publish [--dry-run] [--host <url>] [--visibility unlisted|public] [--placement <lat>,<lng>,<radius>] [--json]`.
  1. `dv mod check` must pass; on failure it exits with its findings and makes no request.
  2. `dv mod pack` gives the archive and its SHA-256.
  3. Without `process.stdin.isTTY` it exits with `publish.attestation` and the fix "run this in a terminal; an agent cannot confirm for you". With a TTY it shows the C14 `ModDeclarations` in plain words, the human types `publish`, and `PublishAttestation {confirmedAt, declarations, liveHuman: true}` is recorded.
  4. `POST /ugc/uploads {purpose: 'mod_archive', contentType: 'application/zip', bytes}`, then a PUT to `putUrl` with the signed `Content-Type`.
  5. `POST /mods/:id/versions` with `uploadId`, manifest, changelog (from `MODLOG.md`'s top entry or `--changelog`), visibility, attestation and optional placement.
  6. It polls route 35 version detail every 10 s for up to 2 minutes and prints the state (`scanning`, `needs_review`, `rejected` with findings, `removed` with the generic message).
  - `--dry-run` runs steps 1–2, shows step 3's declarations without recording them, refreshes the token through route 8 to prove it is valid on the host, and prints the requests of steps 4–5 without sending them. It exits 0.
- `tools/cli/src/mcp`: `mod.publish` returns `{needs_human: true, command: 'dv mod publish'}` and never uploads.
- `packages/identity/src/openai.ts`: `link('openai')`. With `auth.openaiWeb` off → rejects `feature_disabled` without navigating. On → a full-page navigation to `/account/link/openai`, which calls route 11 start and redirects to `authorizeUrl`.
- `apps/web/public/account/callback.html` (+ a small script): forwards `code` and `state` to route 11 callback with `fetch` and the Bearer token (DL-189), updates `dv-identity`, and returns to `/link`. It lives under `/account/*`, the only non-isolated path.
- M13c1's `/link` provider registry gains the `openai` entry, shown only when the flag is on.
- `/link` rules in the CLI's messages: if the browser says "Link an account to publish", the CLI explains that publishing needs a linked account (ADR-0018) and how to finish.
- Kit docs: the publish section of `packages/mod-sdk/AGENTS.md`, mirrored in `skills/publish-experience/SKILL.md` (and the `.claude/skills`, `.agents/skills` mirrors), within the `check:agents` and `check:skills` limits.
- Staging suite `tests/staging/mod-publish.test.ts`:
  - it mints the CI staff JWT from `CI_STAFF_DEVICE_JWK` (DL-192);
  - it creates a `linked` test profile through `POST /api/v1/_test/linked-profile` (non-prod only, `S:ops`, provider `supabase-oauth` with a synthetic subject `test:<uuid>`);
  - it requests a device code, approves it with that profile, polls the CLI token, and runs `dv mod publish --dry-run` on the example experience against staging;
  - it uploads and posts route 36 for real (staging keeps `ugc.publish` false, so the result stays private).

## Scope out
- Flow B (`dv studio` with ChatGPT plan usage) and flow D (ChatGPT plugin): only after an ADR (DL-148).
- npm publication of `@dv/cli` and `@dv/mod-sdk`: waits for Q-22. By default both ship as tarballs (`pnpm --filter <pkg> pack`) attached to the release by M14b3's release job. `license` is MIT and `files` is set, with no `publishConfig` until the owner confirms.
- The `supabase-oauth` link UI: not in v1 (DL-240).

## Deliverables
- `tools/cli/src/publish/{login,logout,client,publish,attest,credentials,index}.ts`; `tools/cli/src/mcp/tools/mod-publish.ts` (edit); tests `tools/cli/test/{login,publish,dry-run,credentials,mcp-publish}.test.ts` with a fake HTTP server.
- `packages/identity/src/openai.ts`, `packages/identity/test/openai.test.ts`; `apps/web/public/account/callback.html`, `apps/web/src/account/{callback,link-openai}.ts`; `/link` provider registry entry; `tests/e2e/link.spec.ts` (extended).
- `services/edge/src/routes/test.ts`: `/_test/linked-profile` (non-prod, `S:ops`).
- `tests/staging/mod-publish.test.ts`.
- `packages/mod-sdk/AGENTS.md` publish section; `skills/publish-experience/SKILL.md` and mirrors.
- `tools/cli/package.json`, `packages/mod-sdk/package.json` (`license`, `files`).
- Secrets and gates: `CI_STAFF_DEVICE_JWK` and the staging URL for `test:staging` (absent → `SKIP … CI_STAFF_DEVICE_JWK not set`, exit 0 locally). `OPENAI_OIDC_CLIENT_SECRET` stays unset unless OpenAI grants a client. Q-22 gates only the npm step.

## Interfaces
- C14 1.0: `PublishAttestation`, `ModDeclarations`, `ModVersionsReq`, `ModErrorCode` (`publish.attestation`, `publish.flag_off`, `publish.rate`) are used as typed.
- C12 1.1: client use of routes 8–11, 34–36; `IdentityService.link('openai')` as declared. The `/_test/` route stays outside C12 (route 49 namespace).
- No contract change.

## Acceptance criteria
- AC-1 Given a fake server that answers `authorization_pending` twice, `slow_down` once and then a token When `dv login --json` runs with a fake clock Then it prints `user_code` and `verification_uri` once, waits 5, 5, 5 and then 10 s between polls, writes the credentials file with mode 0600 on POSIX, and neither stdout nor stderr contains the token — proof: `pnpm check:unit -- tools/cli`
- AC-2 Given the fake server answering `expired_token` (and, in a second run, `access_denied`) When `dv login --json` runs Then it exits non-zero with a JSON error whose `fix` says to run `dv login` again (or to ask for approval again) — proof: `pnpm check:unit -- tools/cli`
- AC-3 Given the example experience and a failing `dv mod check` fixture When `dv mod publish` runs Then it exits with the check findings and the fake server records no request — proof: `pnpm check:unit -- tools/cli`
- AC-4 Given a passing workspace When `dv mod publish` runs without a TTY Then it exits with `publish.attestation` and the terminal fix; with a simulated TTY where the human types `publish` Then the server records, in order, the upload request (`purpose: 'mod_archive'`), the PUT with the signed `Content-Type`, and route 36 with an `Idempotency-Key` and `attestation.liveHuman = true`, and the CLI prints state `scanning` — proof: `pnpm check:unit -- tools/cli`
- AC-5 Given an expired access token and a valid refresh token When `dv mod publish --dry-run` runs Then the only requests are one route 8 refresh, the CLI prints the planned upload and route 36 requests, writes no attestation, and exits 0 — proof: `pnpm check:unit -- tools/cli`
- AC-6 Given `thabay-mcp` When its `mod.publish` tool is called Then it returns `{needs_human: true, command: 'dv mod publish'}` and the fake server records no request — proof: `pnpm check:unit -- tools/cli`
- AC-7 Given `auth.openaiWeb` off When `link('openai')` is called Then it rejects with `feature_disabled` and does not navigate; with the flag on and route fixtures When the player starts the link on `/link` Then the browser reaches `/account/link/openai`, the callback page posts `code` and `state` with an `Authorization` header, `crossOriginIsolated` is false on `/account/callback` and true on `/link`, and `/link` then shows the code field — proof: `pnpm check:unit -- packages/identity && pnpm check:e2e -- --project=chromium-webgl2 --grep @link`
- AC-8 Given the kit When the CI mod checks run Then `dv --help` lists `login`, `logout` and `mod publish` with their help texts, the example mods pass, the mirrored skills are byte-equal, and the instruction files are within their size limits — proof: `pnpm check:mods && pnpm check:skills && pnpm check:agents`
- AC-9 Given staging and `CI_STAFF_DEVICE_JWK` When the staging suite runs Then a fresh `linked` test profile approves a device code, the CLI token has `scp = ['mods:publish']`, `dv mod publish --dry-run` exits 0 against staging, and a real route 36 call answers 202 with state `scanning` — proof: `pnpm test:staging -- mod-publish`
- AC-10 Given the production build When route and secret checks run Then `/_test/linked-profile` is absent and no secret pattern is in the client bundle — proof: `pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`
- AC-11 Given this branch's PR When the Preview deploys Then smoke passes and `/account/callback` is served without COOP and COEP — proof: manual: desktop browser, open `<preview-url>/account/callback` with devtools › Network, read the response headers; then `pnpm check:smoke -- <preview-url>`

## Test plan
- Unit: `tools/cli` login, publish, dry-run, credentials and MCP tests against a fake HTTP server and fake clock; `packages/identity` openai adapter; `pnpm check:unit -- tools/cli packages/identity`.
- E2E: `@link` (provider registry, callback page isolation); `pnpm check:e2e -- --project=chromium-webgl2 --grep @link`.
- Kit gates: `pnpm check:mods && pnpm check:skills && pnpm check:agents`.
- Staging: `pnpm test:staging -- mod-publish`.
- Static: `pnpm check:prod-routes`, `pnpm check:secrets -- apps/web/dist`.

## Demo script
1. In a `dv init` workspace with the example experience, run `dv login --host <staging>`; open the printed URL on a phone; approve with a linked test profile.
2. `dv mod publish --dry-run`; read the plan.
3. `dv mod publish`; type `publish` at the prompt; watch `scanning` then `needs_review`.
4. Ask the agent to publish; it answers with the `needs_human` command instead.
5. `dv logout`; the credentials file is gone.

## Effort
1 session; ≈ 32 files; risk **medium**. TTY handling across platforms and the staging suite's setup are the uncertain parts.

## Risks & fallbacks
- **Keychain library unusable** on a platform: the 0600 file is the default and the only path the ACs test. Windows file ACLs are not POSIX modes: write the file under the user profile and record a Builder note.
- **Staging test route abuse**: `/_test/linked-profile` needs `S:ops`, creates only `test:`-subject identities, and is absent in production (`check:prod-routes`).
- **The provider's callback cannot carry the Bearer token** (it is a top-level redirect): the static page reads the token from `dv-identity` on the same origin and adds it to `fetch` (DL-189). If storage access fails on iOS standalone, the page says "Finish linking on the device that started it".
- **OpenAI never grants a client** (F-060 trial): the adapter stays dark, and ADR-0018's ladder decides P2 before M14a.

## Notes for the Builder
- Read first: `12-modding-publish.md` C§1.4, C§1.6, C§2, C§3 (steps 1–5); `12-modding-contracts.md` B§1 (`ModDeclarations`), B§7; `09-backend-contracts.md` §2.3–§2.5; `spec/05-api-and-realtime.md` §2; ADR-0018, ADR-0019.
- The human confirmation is the point of the flow. No flag, environment variable or `--yes` may skip the TTY prompt.
- Every CLI error is JSON `{code, file?, line?, fix}` under `--json`.
- Branch `m13c3-publish-cli-link`.
