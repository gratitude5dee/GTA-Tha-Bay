# M13b4 — forum-ui

## Goal
The main menu's **Community** gains a working **Forum**. Players browse boards, list threads (sort *new*/*top*, title search), read a thread, vote, compose threads and posts with attachments, and report any thread, post or attachment. The UI follows the posting rules M13b1 enforces. Gate messages say what to do, rate limits show a countdown, held, removed and locked states render as `10-ui-pages.md` §2.11 specifies, and an open thread polls for new posts every 15 s while visible. User text is only ever rendered as text. A thread linked to an experience or mod shows its card, with **Show on map** for experiences. The forum works with keyboard, gamepad and touch, passes the axe gate, and is flat-only (XR shows the exit panel).

## Requirements
- R-MOD-03: the forum in the main menu, where players submit, discuss and vote.
- R-UI-03: the forum page family of the implied page set.
- R-IP-03: a report button on every forum surface, with `copyright` routed to the DMCA page.

## Depends on
- **M13b1**: routes 38–40 and 41 (extended), forum DTOs in `packages/shared/src/api/v1.ts`, `FORUM_BOARDS`, `FORUM_LIMITS`, `validateFieldNote`.
- **M04b1**: shell, kit, focus navigation, i18n, toasts, page registry (Community registered as "Coming soon").
- Contracts: C12 1.1.0 (routes 34, 38–41; `ReportCategory`; `ApiError.retryAfterMs`), C06 1.1.0 (`UiBridge` for "Show on map"), C16 1.1.0 (`ui.page`).

## Scope in
- `packages/ui/src/pages/forum/`:
  - `BoardsPage`: the boards from `FORUM_BOARDS`. A board whose `minTier` is above the player's tier shows a lock and the right CTA.
  - `ThreadListPage`: title, author display name, score, post count, last-post time, `locked` chip. Sort *new*/*top*. The search box sends `q` (3–80 characters, validated before the request). Cursor paging through a sentinel.
  - `ThreadPage`: posts oldest first, vote buttons ▲/▼ with the current value, and a linked-object card (`ForumThreadDto.linked` from M13b2 when present). It polls `GET …/posts?since=` every 15 s while the thread is open and `document.visibilityState === 'visible'`, and pauses otherwise.
  - `ComposePage`: title 3–120, body 1–10,000 with a live counter. Attachments go through route 34 (`purpose: 'forum_attachment'`), with the count limit from `FORUM_LIMITS.attachments`. The `field-notes` board pre-fills the field-note template and runs `validateFieldNote` before submit.
- Posting gates (composer replaced by an explanation and one CTA):
  - tier `local` → "Register this device";
  - `forbidden` with `details.reason = 'account_age'` → "Posting opens 72 hours after registration", with the time from `retryAfterMs`;
  - bracket not `18p` → the neutral explanation;
  - `forum.enabled` false → the Forum tab is hidden. Store tabs are unaffected.
- Errors: `rate_limited` shows a countdown from `retryAfterMs` and re-enables Send at zero. `tier_required`, `forbidden` and `bad_request` map to message keys. No raw error text is shown.
- States:
  - `held`: the author sees "Waiting for review"; others see nothing.
  - `removed`: a tombstone line "Removed by moderators".
  - `locked`: no composer.
  - An empty board shows an empty state.
- Votes: optimistic update; reverted with a toast on error. No vote button on one's own post.
- Report:
  - `ReportButton` (from M06b2) on every thread (it reports the opening post: `forum_post`), every post and every attachment (`forum_attachment`). The category list is `ReportCategory`.
  - `copyright` navigates to `/legal/dmca`, because the API answers 409 with `details.redirect`.
  - The `report-everywhere` unit test is extended so every UGC component type in `packages/ui` (forum, experience and mod cards, published-NPC card, chat turn) renders `ReportButton`.
- Rendering rules: text nodes only. No Markdown and no auto-linking in v1, as `10-ui-pages.md` §2.11 rule 5 states. The lint rule `no-inner-html` covers `packages/ui`. Images load only from `BootConfig.hosts.ugc` with `crossorigin="anonymous"`.
- Navigation: Community › Forum route ids, back stack, focus order, landmarks, reduced motion, gamepad focus ring and touch targets ≥ 44 px. `ui.page` telemetry uses the existing `PageId` enum, with new page ids added to the S10 enum.
- Locale strings `forum.*` in `en`.

## Scope out
- Moderator console and case views (staff tools use route 43 directly) → M13d1 and later.
- Legal forms behind `/legal/dmca` → M13d2. Until it lands, the link opens the M00 legal stub.
- "My creations" (mod versions, placements, appeals): not in this register row. It is listed for the Architect.
- Markdown rendering: not in v1.

## Deliverables
- `packages/ui/src/pages/forum/{BoardsPage,ThreadListPage,ThreadPage,ComposePage,PostView,VoteButtons,LinkedCard,GateNotice,api,poller,index}.tsx|ts`.
- `packages/ui/src/pages/community/` (Forum tab wired in; the existing Coming-soon stub replaced for this tab).
- `packages/ui/src/i18n/en/forum.json`; `PageId` additions.
- Tests: `packages/ui/src/pages/forum/forum.spec.ts` (poller visibility, state rendering, gate mapping, `q` validation), `packages/ui/test/report-everywhere.spec.ts` (extended), `tests/e2e/ui-forum.spec.ts` (`@ui-forum`); API fixtures `tests/e2e/fixtures/forum/*.json` shaped by the M13b1 DTOs and served by Playwright route interception.
- `eslint.config.js`: `no-inner-html` scope confirmed for `packages/ui/src/pages/forum`.
- Secrets: none.

## Interfaces
- C12 1.1: client calls to routes 34, 38–41 with the M13b1 DTOs. `retryAfterMs` and `details` are read defensively.
- C06 1.1: "Show on map" sends a `UiCommand` that opens the phone Map app focused on the experience (existing command from M02c2/M13a3).
- C16 1.1: `ui.page` with new `PageId` values. Additions to S10's `PageId` enum are UI-owned, not a contract change.
- No contract change.

## Acceptance criteria
- AC-1 Given a thread open with fake timers When the page is visible for 45 s, hidden for 60 s and visible again Then the poller makes exactly 3 requests while visible, none while hidden, and one immediately on return; `held` posts render "Waiting for review" only for their author; `removed` renders the tombstone; a `q` of 2 characters is rejected without a request — proof: `pnpm check:unit -- packages/ui`
- AC-2 Given forum fixtures When a keyboard-only user opens Community › Forum › General, switches to *top*, searches `market`, opens a thread and votes ▲ Then each step is reachable by Tab/Enter, the list order and search result match the fixture, and the vote sends `PUT /forum/votes` with `value: 1` and shows the new score — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`
- AC-3 Given fixtures for a `local` profile, a `device` profile whose POST answers `forbidden` with `details.reason = 'account_age'` and `retryAfterMs` 7,200,000, and a `device` profile whose POST answers `rate_limited` with `retryAfterMs` 30,000 When each opens the composer and sends Then the first sees "Register this device" with its CTA, the second sees the 72-hour message with the time two hours ahead, and the third sees a countdown from 30 and Send re-enabled at 0 — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`
- AC-4 Given a thread fixture with a locked flag, a removed post and a linked experience When it is opened Then no composer renders, the tombstone line shows, and the experience card's Show on map sends the map command with that experience id — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`
- AC-5 Given a post When the player reports it as `harassment_hate` and another as `copyright` Then the first posts `ReportReq {target: {kind: 'forum_post'}}` and shows the thanks toast, and the second, on the fixture's 409 with `details.redirect`, navigates to `/legal/dmca` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`
- AC-6 Given the `field-notes` board When the composer opens Then the template sections are pre-filled, and removing `## Verification` blocks Send with the section named — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`
- AC-7 Given a post body containing `<img src=x onerror=alert(1)>` and a URL When rendered Then the text shows literally, no element is created from it, no link is created, and `pnpm lint` reports no `no-inner-html` violation in `packages/ui` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum && pnpm lint`
- AC-8 Given every UGC component type in `packages/ui` When rendered in the unit harness Then each renders `ReportButton`, and choosing `copyright` navigates to `/legal/dmca` — proof: `pnpm check:unit -- packages/ui`
- AC-9 Given the iPhone viewport with touch When a thread is opened, voted and replied to Then every control is reachable, no horizontal scroll appears at `uiScale` 150 %, and the reply posts — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-forum`
- AC-10 Given the forum pages with fixtures When the axe scan runs Then there are zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-11 Given `forum.enabled` false in the boot fixture When Community opens Then the Forum tab is absent and the store tabs still render; `check:i18n` reports no missing `en` key — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum && pnpm check:i18n`
- AC-12 Given this branch's PR When the Preview deploys Then smoke passes and Community › Forum loads boards from the staging API — proof: manual: desktop browser, open the Preview URL, Main menu › Community › Forum; then `pnpm check:smoke -- <preview-url>`

## Test plan
- Unit: `forum.spec.ts`, `report-everywhere.spec.ts`; `pnpm check:unit -- packages/ui`.
- E2E: `@ui-forum` on `chromium-webgl2` (keyboard and gamepad paths) and `webkit-webgl2` (touch); `@ui-a11y` over the forum pages; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`.
- Static: `pnpm lint` (`no-inner-html`), `pnpm check:i18n`, `pnpm typecheck`.
- Deployed: Preview smoke (AC-12).

## Demo script
1. `pnpm dev` with a QA device profile older than 72 h (QA flag in the bridge).
2. Main menu › Community › Forum › General; switch sort; search a word.
3. Open a thread; vote; reply; watch the reply appear.
4. Post twice quickly; read the countdown.
5. Report a post as copyright; land on the DMCA page.
6. Tab through the whole flow without a mouse.

## Effort
1 session; ≈ 26 files; risk **low**. Most of the work is page wiring on the existing kit. The poller and gate mapping need careful tests.

## Risks & fallbacks
- **The `PageId` enum lives in a file shared with telemetry schemas** (`ui.page` props): add the ids in both places in the same commit. If the telemetry schema is generated, regenerate it and run `pnpm check:telemetry`.
- **Fixture drift from the real DTOs**: the fixtures are typed against `ForumThreadDto`/`ForumPostDto` (a `satisfies` check in a `.ts` fixture builder), so a DTO change fails `pnpm typecheck`.
- **axe flags the vote buttons** (icon-only): give them `aria-label` from locale keys with the current score in `aria-describedby`.

## Notes for the Builder
- Read first: `10-ui-pages.md` §2.11 (rules 1–6), §2.12 (cards), §5–§6 (runtime and platform); `10-ui.md` §2.4–§2.6 (shell, navigation, input); `12-modding-publish.md` C§5 (boards, states, UX list; its Markdown sentence is superseded for v1 by S10's text-only rule); `spec/05-api-and-realtime.md` §3 rows 38–41.
- Never call `innerHTML`, `dangerouslySetInnerHTML` or a Markdown renderer on user text.
- Order of work: api client and poller → pages → gates and errors → report wiring → fixtures and e2e → a11y pass.
- Branch `m13b4-forum-ui`.
