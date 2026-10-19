# M12d — online-page-invites

## Goal
Players reach multiplayer through a real **Play online** page instead of the M04b1 "Coming soon" stub. The page lets a player join a room, enter or create an invite code, see room status, and see their own presence status and server notices. Close codes become clear messages. The milestone also adds a text-chat panel (opt-in, off by default) and nameplates over remote players. Everything binds to the room client (M12b1–M12b2) and to presence and invites (M12c1). No server code changes. A QA-only fake service makes every state testable in CI without a rooms Worker.

## Requirements
- R-ROLL-02: gives the player-facing entry to the Durable Object rooms and presence socket.
- R-UI-03: the "online" page implied by the main menu exists, is reachable by keyboard, gamepad and touch, and passes the a11y gate.

## Depends on
- **M12c1** (resume, drain, `PresenceDO` route 26, invites route 25, presence ticket route 54 per DL-186, `PresenceFrame` in `packages/net/src/protocol/presence.ts`, mods refusal 4007 hook). **M04b1** (shell, kit, focus navigation, i18n, toasts, page registry with the `online` stub, `UiPrefs`).
- R-ROLL-01: this milestone runs after M05c2 is shipped and tested on staging, as every block F milestone from M12b1 does.
- Contracts: C11 1.0 (`PROTOCOL_VERSION` 2; `Close` codes, `Frame.CHAT`, `EvKind.Chat`, `EvKind.Joined`, `EvKind.Notice`, `NET.CHAT_MAX_CHARS` 280), C12 1.1 (routes 22, 23, 25, 26; `AssignReq.modsActive`; `BootConfig.flags`), C06 1.1 (`ui-bridge.ts` `VmKey` `hud.${string}`, `UiBridge.toast`), C16 1.1 (`ui.page`). Route 54 is the Wave 5 addition of DL-186 (`spec/05-api-and-realtime.md` §3), delivered by M12c1.

## Scope in
- `packages/ui/src/pages/online/` replaces the stub and keeps the page id `online`.
  - **Gate**, in this order: the `mp.enabled` flag is false → the page is hidden; the identity tier is below `device` → a CTA to the register page (M12a2); the client is offline → actions are disabled with a reason; `modsActive()` returns true → **Join** is replaced by "Turn off mods to play online".
  - `modsActive` comes from a `ModsActiveSource` port that returns `false` until M13a3 wires `ModHost.modsActive()`.
- **Join a room:** route 23 `assign {district:'sf', modsActive}` through the M12b room client, then the connecting, connected and failed states. Room status comes from route 22 (`players/capacity`) and refreshes every 10 s while the page is visible.
- **Enter invite code:** six characters. Input is upper-cased and stripped of spaces. Validate with the invite-code pattern exported by M12c1's invite module. If M12c1 exports none, add `INVITE_CODE_RE` beside the server generator in `packages/net` so client and server share one source. On submit, call `assign` with `inviteCode`. The field is flat-only (DL-142); in XR the page offers Join and Create invite only.
- **Create invite:** route 25 → code, a countdown to `exp` (10 min) and **Copy**. The Clipboard API is called inside the click handler; if it fails, the code is selected for manual copy.
- **Presence:** route 54 ticket → route 26 socket (M12c1 client). The page shows the player's own status and `notice` banners (`drain`, `maintenance`). An `invite` frame raises a toast "<name> invited you" with **Join**. No friend list exists in v1 (Q-29, DL-186).
- **Close codes:** a table maps 1000, 1008, 1013 and 4001–4008 to `online.close.<code>` keys. 4007 reads "Mods are active". The reconnect behaviour stays in the M12b client (C11 §1.3); the page only renders it.
- **Chat panel** (`packages/ui/src/pages/online/chat.tsx`).
  - Hidden unless the device-scoped `UiPrefs.chat` is true. It defaults to false and is set under Settings → Privacy as "Text chat (online)".
  - The composer caps input at `NET.CHAT_MAX_CHARS` and sends `Frame.CHAT` through the room client. Incoming `EvKind.Chat` lines are rendered as text nodes only, with the sender's name from `EvKind.Joined`.
  - Every line has the kit `ReportButton` (route 41, `target {kind: 'chat_turn', id: 'room:<roomId>:<evSeq>'}` from the line's `EV` sequence number; M12c2 snapshots the line server-side, DL-239, DL-543). The panel holds 100 lines and drops the oldest.
  - Moderation before fan-out is server work (M12c2); the panel shows no unmoderated echo of the player's own line.
- **Nameplates:**
  - `packages/ui/src/hud/nameplates.ts` holds a pure selection function: ≤ 15 plates within 40 m of the camera, nearest first, hidden while a cutscene plays and while an XR session is presenting.
  - `NameplateLayer` renders screen positions published as `hud.nameplates` (`{slot, name, x, y, d}[]`). The main-thread net view in `packages/engine/src/net` projects the interpolated remote poses with the active camera once per frame.
  - Display names are text nodes, and the layer honours `uiScale`.
- **Non-pausing overlays:** Pause and Phone become non-pausing overlays while `ctx.net` is non-null (`10-ui-pages.md` §2.13). Add this only if M12b2 did not.
- QA-only `__dvBridge.online.useFake(script)` (`packages/ui/src/pages/online/fake.ts`, imported only when `VITE_DV_QA === '1'`). It swaps the page's `OnlineService` for a scripted fake: room status, assign result, close code, invite frame, chat lines and remote players.
- Telemetry: `ui.page {page:'online', ms}` only (existing name).

## Scope out
- Friend list and friend presence: Q-29 (no v1 milestone).
- Chat moderation, strikes and rate limits on the server: M12c2.
- Online activities UI (race lobby): M12e uses `EV Activity`. Online fighter: ADR-0028, not v1.
- XR nameplates and the XR online page: not in v1. The online page is a flat page and text entry is flat-only (DL-142); nameplates hide while an XR session presents (DL-229).
- a11y audit and translations: M14c.

## Deliverables
- `packages/ui/src/pages/online/{index.tsx, online-service.ts, join.tsx, invite.tsx, presence.tsx, chat.tsx, close-codes.ts, gate.ts, fake.ts}`.
- `packages/ui/src/hud/{nameplates.ts, NameplateLayer.tsx}`. The `hud.nameplates` publisher goes in `packages/engine/src/net/nameplates.ts`, next to the M12b2 net view.
- `content/ui/i18n/en.json`: keys `online.*`, `online.close.<code>` for every code in the table, `settings.privacy.chat`, `nameplate.*`.
- `packages/ui/src/settings/privacy.tsx`: the chat toggle. `UiPrefs` gains `chat: boolean` (S10 data, `10-ui-pages.md` §4.3; not a contract).
- If needed: `packages/net/src/invites.ts` gains the shared `INVITE_CODE_RE`.
- Tests:
  - `packages/ui/src/pages/online/test/{gate.spec.ts, close-codes.spec.ts, invite.spec.ts, chat.spec.ts}`;
  - `packages/ui/src/hud/test/nameplates.spec.ts`;
  - `tests/e2e/online.spec.ts` (tags `@ui-online`; the page joins the `@ui-a11y` page list).
- No new scripts, secrets or flags. `mp.enabled` and the rooms secrets already exist (M12b1).

## Interfaces
- C11 1.0: frames and close codes are consumed unchanged. C12 1.1: routes 22, 23, 25, 26 and route 54 (DL-186) are consumed unchanged. C06 1.1: `hud.nameplates` is a new key inside the `hud.${string}` template, so the shape does not change. C16 1.1: `ui.page`.
- `OnlineService` is a page-local port (not a contract): `assign(code?)`, `roomStatus(id)`, `createInvite()`, `presence()`, `sendChat(text)`, `onEvent(cb)`.
- No contract change.

## Acceptance criteria
- AC-1 Given the gate table (flag off, tier `local`, offline, `modsActive` true, all clear) When `gate.spec.ts` evaluates each row Then the page is hidden, shows the register CTA, disables actions with a reason, replaces Join with "Turn off mods to play online", or enables Join, respectively — proof: `pnpm check:unit -- packages/ui/src/pages/online`
- AC-2 Given the close-code table When `close-codes.spec.ts` walks 1000, 1008, 1013 and 4001–4008 Then every code maps to a key that exists in `en.json`, 4007 maps to `online.close.4007` ("Mods are active"), and no key contains the display-name literal — proof: `pnpm check:unit -- packages/ui/src/pages/online`
- AC-3 Given the invite field When `ab 12cd`, `AB12C`, `AB12CD7` and a code with a character outside the shared pattern are entered Then only the normalised six-character valid code enables Join, and the create-invite countdown reaches 0:00 exactly at `exp` with a fake clock — proof: `pnpm check:unit -- packages/ui/src/pages/online`
- AC-4 Given a QA build with `__dvBridge.online.useFake` scripting `assign` success, room status `{players: 3, capacity: 16}` and then close code 4008 When the player joins by keyboard only Then the page shows connecting, then "3 / 16", then the draining notice, and focus never leaves the page — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-online`
- AC-5 Given the same fake on the iPhone viewport When the player creates an invite by touch Then the code, the countdown and Copy are visible inside the safe area, and the scripted `invite` presence frame raises one toast with Join — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-online`
- AC-6 Given `UiPrefs.chat` false When a room is joined Then no chat panel exists in the DOM; given it true, a scripted `EvKind.Chat` line `<img src=x onerror=alert(1)>` is shown literally as text, a 281-character input is cut to 280, and the line's Report button posts route 41 with subject `chat_turn` and a `room:<roomId>:<evSeq>` id — proof: `pnpm check:unit -- packages/ui/src/pages/online && pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-online`
- AC-7 Given 20 remote players at distances from 5 m to 80 m When the nameplate selector runs Then it returns at most 15 plates, all within 40 m, nearest first; with `cutscenePlaying` or `xrPresenting` true it returns none — proof: `pnpm check:unit -- packages/ui/src/hud`
- AC-8 Given the online page with the fake in the joined state When the a11y scan covers every flat page Then it reports zero critical or serious findings — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`
- AC-9 Given the production build (no `VITE_DV_QA`) When it is checked Then no `/_test/` route and no secret pattern is present and the bundle stays within its budgets, so the app remains deployable — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist && pnpm check:bundle`
- AC-10 Given two desktop browsers signed in as two `device`-tier profiles on staging with `mp.enabled` true When A creates an invite and B enters the code, and both enable Text chat Then both appear in one room, each sees the other's nameplate, a chat line from A appears on B, and closing A's tab shows B the left state — proof: manual: desktop browser (Chrome and Safari on the Mac), staging URL, steps as written in this AC; screenshots attached to the PR

## Test plan
- **Unit (Vitest):** `gate.spec.ts`, `close-codes.spec.ts`, `invite.spec.ts`, `chat.spec.ts` (text-node rendering, cap, report payload), `nameplates.spec.ts`. Command: `pnpm check:unit -- packages/ui`.
- **E2E:** `tests/e2e/online.spec.ts` `@ui-online` on `chromium-webgl2` and `webkit-webgl2` (iPhone viewport 844 × 390 touch); `@ui-a11y` includes the page.
- **Manual:** AC-10 on staging.
- **Static:** `pnpm lint` (the `no-inner-html` rule over `packages/ui`) and `pnpm typecheck`.

## Demo script
1. `pnpm dev`; open the printed localhost URL. In the console run `__dvBridge.online.useFake('happy')`.
2. Main menu → Play online. Join with Enter; watch connecting, then "3 / 16".
3. Run `__dvBridge.online.useFake('close-4007')`; join again; read "Mods are active".
4. Create invite; watch the countdown; press Copy.
5. Settings → Privacy → Text chat on; back to the room; read a scripted chat line; press Report.
6. On staging, repeat AC-10 with two browsers.

## Effort
0.3 session (one short session), ≈ 22 hand-written files. Risk low. Most behaviour is UI over shipped clients.

## Risks & fallbacks
- M12c1 did not export the invite-code pattern or the presence client in a reusable form: add the pattern to `packages/net/src/invites.ts` and wrap the presence socket in `online-service.ts`. Do not touch `services/rooms`.
- The room client exposes no per-frame remote pose list for nameplates: publish `hud.nameplates` from the interpolation buffer M12b2 already keeps. If none is reachable within the session, ship the page and chat, move nameplates to M14c and say so in the report.
- Clipboard write rejected on iOS: the select-text fallback covers it. The AC asserts visibility, not clipboard content.

## Notes for the Builder
- Read first: `10-ui-pages.md` §2.13, §4.3; `10-ui-hud-xr.md` §2.10, §8; `09-backend-contracts.md` §1.2–§1.5 (constants, close codes, EV payloads); `spec/05-api-and-realtime.md` §3 (route 54), §4.7 (PresenceDO); `spec/11-decision-log-2.md` DL-186; `spec/99-open-questions.md` Q-29.
- Order: service port and fake → gate and close codes → join, invite, presence → chat → nameplates → e2e and a11y.
- Every user string goes through `t()`. Render user text only as text nodes; `no-inner-html` must stay green.
- `navigator.clipboard` and every XR call must run inside the user-gesture handler.
- Branch `m12d-online-page-invites`.
