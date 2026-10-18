# M06b3 — npc-builder-ui

## Goal
Players can build an NPC in the shell. When this session ends, page `npcs` (`/menu/npcs`, `npcs/:id/:step`) holds "My NPCs" (draft cards with state chips and limits) and a nine-step stepper over the route 33 API of M06b1 and M06b2: Basics, Backstory, Attestation, Generate and Review, Voice, Preview chat, Reference images, Look, Submit. Each step autosaves the draft. Preview chat streams SSE with a persistent AI badge. Images use route 34 with a manual cover tool and show only their text description. Look offers creator-kit body presets only, with no generation. Submit needs a `linked` profile and shows review status and notes. The page is flat-only and accessible, and every string is translated.

## Requirements
- R-NPC-03: the native NPC builder becomes usable end to end up to submission for review.
- R-UI-03: the NPC Builder page implied by the main menu exists and is reachable through its gate.

## Depends on
- M06b2 (images, submit, community, reports, review routes), M04b2 (creator presets, `MenuScene`, help, kit components).
- Contracts: C10 1.0 (`packages/shared/src/contracts/c10-npc-builder.ts`: `DraftView`, `DraftState`, `DraftFields`, `CreateDraftReq`, `UpdateDraftReq`, `AttachImagesReq`, `JobAccepted`, `SubmitRes`, `CommunityNpc`, `Attestation`).

## Scope in
- Gate per `10-ui.md` page table: flag `npc.builder`, online, 18+ attested; offline or flag off → `disabled`/`hidden` with the reason; in XR the "Exit VR to continue" panel (DL-142).
- My NPCs: one card per draft with a chip for each of the 15 `DraftState` values (`rejected_auto` and `rejected` share "Rejected"; `killed` and `removed` share "Removed"); limits line from `DraftView.limits` and the C1 limits table (3 live drafts P0/P1, 10 linked); "New NPC" disabled at the limit.
- Stepper in the S04 order of `04-npc-builder.md` §C1 (owner of order and content):
  1. Basics: name 2–40, pitch ≤ 280, archetype, district from `content/districts.json`, tags.
  2. Backstory: textarea ≤ 20,000 with live count; `.md`/`.txt` import read locally.
  3. Attestation: only "An original character I made up" is selectable; "This is me" and "A real person who consented" are shown disabled with "not available yet"; the warranty checkbox is required to continue.
  4. Generate and Review: `validate` then `soul` jobs (202, poll `GET /drafts/:id` every 2 s while a job runs), editable form of generated fields with lint inline, Regenerate showing the remaining wait.
  5. Voice: `text` or a catalog `t1` voice only.
  6. Preview chat: `fetch`-read SSE (`meta`, `line.delta`, `line.done`, `effects`, `fallback`, `done`), persistent "AI character" badge, remaining-turns counter, `fallback` shown as an in-character offline line, probe status (n of 5).
  7. Reference images (P1): ≤ 6, crop, user-drawn cover rectangles (no face detection), presigned upload through route 34 then `POST /drafts/:id/images`; each image shows its state and, when `described`, the description offered for `visual_brief`.
  8. Look: a creator-kit body preset (`DraftFields.appearancePreset`) previewed through `MenuScene`; no generate control (DL-OWN-01, DL-175).
  9. Submit: needs tier `linked`; below it a call to action explains linking (no request sent); after submit shows `in_review`, reviewer notes for `changes_requested`, and the case outcome.
- Autosave: `PUT /drafts/:id` debounced 800 ms with `If-Match: <rev>`; a 409 shows "This draft changed elsewhere" with Reload, never discarding typed text.
- Errors through `apiErrorToUi()`: `rate_limited`/`quota_exhausted` show the wait from `retryAfterMs`; `moderation_blocked` shows one fixed message and the content-policy link; `tier_required` shows the call to action. Everything the player types renders as text.
- Report button (`ReportButton`, route 41) on every published NPC card in the community list section of the page.
- Telemetry `npc.builder.step {step, ok}` (C16 1.1).

## Scope out
- Spawning a private NPC in the sandbox world from this page: shown only when the sandbox descriptor exposes the `mode.cmd` that M06b1 registered for private use; otherwise hidden and listed in the PR as a follow-up.
- Look queue requests (`POST /drafts/:id/assets`) → M06b4. Account linking pages → M13c1, M14a. Community browsing as a separate page → M13b4.

## Deliverables
- `packages/ui/src/pages/npc-builder/{index.tsx, list.tsx, stepper.tsx, steps/basics.tsx, steps/backstory.tsx, steps/attestation.tsx, steps/review.tsx, steps/voice.tsx, steps/preview.tsx, steps/images.tsx, steps/look.tsx, steps/submit.tsx, api.ts, sse.ts, autosave.ts, state-chip.ts, cover-tool.ts}`.
- Page registration (`npcs`, `npcs/:id/:step`) in the shell page table; `config/ui/nav.json` item stays gated as above.
- `content/ui/i18n/en.json` keys `npcb.*`.
- `packages/ui/test/{npc-builder.spec.ts, npc-builder-sse.spec.ts, npc-builder-deps.spec.ts}`.
- `tests/e2e/npc-builder-ui.spec.ts` (tags `@npc-builder` and `@npc-builder-ui`), `tests/e2e/fixtures/npc-builder/` (network fixtures for route 34, the R2 PUT and the linked submit path); the a11y page list gains the builder steps.

## Interfaces
- C10 1.0 builder types and C12 1.1 routes 33, 34, 41 consumed as frozen; `UiCommand` (C06 1.1) unchanged.
- No contract change.

## Acceptance criteria
- AC-1 Given a P0 profile online with flag `npc.builder` on When the player opens NPC Builder Then My NPCs shows the limits line "3 drafts", "New NPC" is disabled once three live drafts exist, and with the flag off or offline the menu item shows its disabled reason — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder-ui`
- AC-2 Given a new draft in recorded mode When the player completes Basics, Backstory, Attestation, Generate and Review, Voice and Preview chat Then only the "original" attestation is selectable, Continue stays disabled until the warranty is ticked, lint issues render inline, the voice list holds no `t2` entry, the AI badge stays visible for the whole chat, the remaining-turns counter decreases by one per turn, a recorded `fallback` renders as an in-character line, and the card chip reads "Private" after 5/5 probes — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder-ui`
- AC-3 Given a draft When the player types in three fields within 800 ms and a concurrent edit bumps the server `rev` Then exactly one `PUT` carries the three changes with `If-Match`, and the resulting 409 shows Reload while the typed text stays in the fields — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder-ui`
- AC-4 Given a P1 profile and network fixtures for route 34, the R2 PUT and `/images` When the player adds 6 images, draws a cover rectangle and tries a seventh Then six uploads complete, the seventh is refused before any request, and a `described` image shows its description with an "Add to visual brief" action — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder-ui`
- AC-5 Given the Look and Submit steps When a P1 player opens them, and when a linked fixture session submits Then Look offers creator-kit presets and no generate control, the preset preview sets `MenuScene.active`, P1 Submit shows the linking call to action and sends no request, and the linked submit shows the "In review" chip and later the reviewer notes of a `changes_requested` fixture — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder-ui`
- AC-6 Given the builder units When the chip map, autosave debounce, SSE parser, error mapping and dependency rule run Then all 15 `DraftState` values map to an existing i18n key, the debounce emits one PUT per 800 ms burst, a split SSE chunk parses into the same events as a whole one, `quota_exhausted` with `retryAfterMs` renders a wait, a name `<script>` renders as literal text, and no module under `packages/ui/src/pages/npc-builder` imports a face-detection or landmark package — proof: `pnpm check:unit -- packages/ui`
- AC-7 Given every builder step When the axe scan runs Then there are zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-8 Given the catalogs When the translation check runs Then no `npcb.*` key is missing — proof: `pnpm check:i18n`
- AC-9 Given the branch When it builds and previews Then both succeed and the earlier `@npc-builder` API suite still passes — proof: `pnpm build && pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder && pnpm deploy:preview`

## Test plan
- Unit (`pnpm check:unit -- packages/ui`): `npc-builder.spec.ts` (chips, debounce, limits text, submit gate), `npc-builder-sse.spec.ts` (chunk boundaries, `fallback`, `done`), `npc-builder-deps.spec.ts` (import rule).
- E2E (`chromium-webgl2`): `@npc-builder-ui` against the local web server in the recorded mode that M06b1's suite uses, with network fixtures where no local service exists (R2 S3 endpoint, linked submit); `@ui-a11y`.
- No device test; iPhone single-column layout is covered by the M14c audit.

## Demo script
1. `pnpm dev` in recorded mode; pass age and terms; open NPC Builder.
2. New NPC → fill Basics and Backstory → tick the warranty → Generate.
3. Edit a field in Review; chat three turns in Preview; watch the badge and counter.
4. Register the device (M12a2); add two images; read their descriptions.
5. Pick a body preset; open Submit and read the linking call to action.

## Effort
1 Builder session; about 30 files; risk **medium**. Nine steps are many screens; the SSE reader and autosave conflict path need care.

## Risks & fallbacks
- `10-ui-pages.md` §2.10 lists a different step order, three attestation options, `t2` voice design and a generated character sheet; `04-npc-builder.md` §C1 (S04 owns order and content) and DL-175 win. Follow this file and note it in the PR.
- No local R2 S3 endpoint: the image step's e2e uses network fixtures; the real upload path is proved by M06b2's staging run.
- File budget: if over 40, merge Voice into Review and Look into Submit as sections and keep the step ids.

## Notes for the Builder
- Read first: `04-npc-builder.md` §C1, §C3, §C5 (what the UI may show), §C10; `10-ui-pages.md` §2.10 (layout only), §5; `10-ui.md` page table and routing rules; `spec/05-api-and-realtime.md` route 33 sub-paths.
- Order: api and SSE helpers → list and chips → stepper and autosave → steps 1–6 → images → look → submit → e2e and a11y.
- Read SSE with `fetch` and a stream reader, never `EventSource` (POST body, auth header).
- Never render classifier scores or reasons beyond `DraftView.moderation.reasons` keys mapped to fixed messages.
- Branch `m06b3-npc-builder-ui`.
