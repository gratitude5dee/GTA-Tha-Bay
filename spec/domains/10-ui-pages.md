# S10 — UI/UX Shell, part B: pages (boot to legal), character creator, settings, saves, garage, NPC builder, forum, experiences

> Wave 4 · v0.1 · 2026-10-18 · continues `10-ui.md` (technology, shell, `ScreenDef`, `UiCommand`, page registry). This part carries template §2 (page design, numbered §2.3–2.14) and §4 (data: `PlayerAvatar`, `AppearanceV1`, `UiPrefs`, troubleshooting schema). R-IDs: R-UI-01, R-UI-02, R-UI-03, R-MODE-05, R-IP-03, R-IP-04, R-NPC-03, R-MOD-03, R-MOD-04, R-AUTH-01…03, R-ROLL-02.

## 2. Design

### 2.3 Boot, title, loading, error

1. `BootScreen` shows the wordmark (`BRAND.wordmarkAsset`), a progress bar driven by `app.ready` phases (shell, worker, boot set) and the OSM/DataSF attribution line ("© OpenStreetMap contributors" and the DataSF credit) because the boot splash is one of the three required attribution places [research/auth-ugc-input-maps.md §5.7; research/repos-world.md]. It is a text node, so it is localizable and readable by screen readers.
2. `TitlePage`: wordmark, "Tap to start" / "Press any key" (glyph by active device), build id, links to Credits and Legal. Its first gesture runs `FirstGestureUnlock`. A returning, attested player lands on the main menu one gesture later. The non-affiliation disclaimer is **not** shown here; it lives in Credits and the Terms card, the allowlisted places for the words it contains [research/legal-ip-likeness.md R-NAME-2].
3. `LoadingPage` (mode load): shows the mode art, a progress bar for the descriptor's boot set (`ctx.assets.ready`), a tip line (`hints.json` loading tips, one at a time, 8 s rotation, none under reduced motion), and `markSafePoint('loading')`. Cancel is offered for standalone modes (`UiCommand mode.quit`).
4. `ErrorPage` kinds: `gpu-init` (WebGL2 floor failed), `wasm-load`, `sim-crash` (auto-recover once), `storage-unavailable`, `region-blocked` (online pages only, never blocks single player). Each shows plain text, an error code, "Copy diagnostics", and a Help deep link to the matching troubleshooting topic (§2.14).

### 2.4 Age screen, blocked screen, terms (R-IP-04, D-30)

Order: Title gesture → AgeGate → Terms → profile naming. Rules (numbered, testable):
1. **Neutral.** Three empty numeric fields (month, day, year) ordered by the locale via `Intl.DateTimeFormat(...).formatToParts`; no prefilled values, no dropdown starting at an adult year, no text that states the threshold, `autocomplete="off"`. Heading: "Before you play". This is the "neutral age screen" that lets users enter month, day and year freely and does not encourage falsification [research/legal-ip-likeness.md §5.3, §P4].
2. **Validation.** A date must be a real calendar date, not in the future, year ≥ 1900. An invalid date shows "Enter a valid date" and allows another entry. The date of birth is never stored or sent: only the bracket (`AgeBracket`) and `attestedAt` are kept.
3. **Outcome.** 18 or older → bracket `18p` → `IdentityService.attestAge('18p')` (C12 1.1) persists it in `dv-identity`; the play token then carries `age: '18p'` [09-backend-contracts.md §2.3]. Younger than 18 → `BlockedPage` (below). No server call is made for blocked users.
4. **Blocked.** One neutral message for every blocked case ("You can't play right now."), no reason, no "try again" or "back" control, links only to the public Privacy Policy and Legal pages. The device writes `ageBlocked: true` to IndexedDB `dv-ui` and a mirrored `localStorage` key (each in try/catch) and shows `BlockedPage` on every launch; clearing site data bypasses it, which is accepted. No telemetry is emitted for blocked users. Reasoning: eligibility is 18+ in the terms, content is 17+-rated, and under-13s are blocked (COPPA) [spec/03 D-30; research/legal-ip-likeness.md §5.3, §P4]. A teen path (`TEEN_MODE`) stays off (`DN-S10-01`); the code keeps `AgeBracket` so it can be enabled later without a data migration.
5. **OS age signals.** An `AgeSignalProvider` interface returns `AgeBracket | null`; v1 returns `null` (UNVERIFIED API shape; California AB 1043 applies from 2027-01-01). When it returns a bracket under 18 it overrides the typed date [research/legal-ip-likeness.md §P4]. Wired in M14b.
6. **Terms card** (after a pass): one screen with the Terms of Service and Privacy Policy as links that open the `legal` page inside the shell (the player returns to the card), the AI notice ("Characters, dialogue and some cutscenes are AI-generated and can be wrong"), the content note (mature themes; no firearms or gore, Q-06), the **Diagnostics** and **Gameplay analytics** toggles (default on, one tap to turn off; stored in `PlatformSettings.telemetryConsent`, device-scoped) and one button "Agree and continue". Declining returns to Title. The non-affiliation disclaimer (`BRAND.disclaimer`) is printed at the bottom of this card. Default-on matches S09's definition of the toggles (`DN-S10-02`).
7. After acceptance the shell records `termsVersion` and `acceptedAt` in `dv-ui`; a new `termsVersion` re-shows only the Terms card.

### 2.5 Main menu, continue, new game

**Layout.** Header: profile chip (name, identity tier chip: *This device only* / *Registered* / *Linked*), cloud chip (M12a), offline chip, language shortcut. Body: vertical list (compact) or two-pane with art (expanded). Footer: build id, version, Credits, Legal.

**Items** (order from `config/ui/nav.json`, each with a `PageDef.gate`): Continue · New Game · Modes · Garage · NPC Builder · Community · Experiences & Mods · Play Online · Profile & Saves · Settings · Credits & Legal · Help. Install appears as a chip under the list on Chromium (`beforeinstallprompt`) and is covered by the iOS coach mark (C §2.11).

**Continue.** Shows the last-played save profile: name, act, playtime, cash, last save line ("Saved 2 min ago · Auto-save", red with an icon if `LastSaveStatus.ok` is false) from `ProfileMeta.lastSave`, read through the read-only `dv-saves` handle [01-engine-save-modes.md §C05; research/repos-grand-v.md §2(d)]. "Load game" opens `LoadPage`: slots `story:auto`, `story:1…3` of the selected profile with act, mission title, playtime, `savedAt`; `NEWER_SCHEMA` slots are listed read-only with "Update the game". Choosing a slot sends `UiCommand mode.start { id: 'story', slot }`.

**New Game (DN-S10-03).** Starts a **new save profile**: name entry (1–80 chars, NFC, unique case-insensitively, `SaveService.createProfile`) → creator (§2.8) → intro. Separate playthroughs are separate profiles (≤ 64), which fits the C05 model where `story:auto` is overwritten by autosave. If the active profile has no story data yet, New Game reuses it. Errors `NAME_TAKEN` and `PROFILE_LIMIT` are shown inline. Story slots 1–3 are manual saves taken at safehouses.

### 2.6 Mode select and the unlock flow (R-MODE-05, A-06)

Tiles come from `GameModeDescriptor[]` (`standalone: true`), ordered by `tile.order`, with art `tile.art` (C07 `AssetRef`) and title `titleKey`. Tile state is computed, not stored:

| State | Condition | Presentation | Action |
|---|---|---|---|
| `ready` | `status: 'available'` and (`unlock` is null or in `UnlockRegistry`) | full art, summary line, NEW badge until first opened | Play / Continue |
| `locked` | `available`, unlock not yet emitted | dimmed art, lock icon, title, hint "Find this in the story" (generic; no mission spoilers) | none (focusable, `aria-disabled`, hint read aloud) |
| `comingSoon` | `status: 'comingSoon'` (A-06 stubs) | dimmed, "Coming soon" label, title | none |
| `unavailable` | requires network and offline, or `requires.xr` is `none` while in a headset | dimmed with reason | none |
| hidden | the mode's `UnlockDef.hidden` is true and not unlocked | not rendered | — |

Rules: (1) tiles for Story and Sandbox have `unlock: null` and are always `ready`; Sandbox shows "Progress here doesn't count toward the story" (C05 rule 3). (2) The summary line (best medal, last played) comes from an optional `GameModeUI.summary(slice)` (C06 1.1) with a generic "Last played <date>" fallback from the slot's `savedAt`. (3) On `UnlockRegistry.onUnlocked` the shell shows an `unlock` toast "New mode unlocked: <title>" with an "Open" action, and the tile gets NEW (A-06, R-MODE-05; C06 ModeHost rule 5). (4) A tile press sends `UiCommand mode.start`; a mode with a different `simProfile` shows "Switching… this takes a moment" because `SimHost.restart` runs behind the loading screen (C06 rule 3). (5) `?unlockAll=1` exists only in QA builds and shows a "QA unlock" ribbon; production ignores it (06 §5).

### 2.7 Profile, saves, accounts

**Profile page.** Sections: *Character* (portrait render, "Edit appearance" → creator in edit mode), *Playthroughs* (profile list), *Account* (identity tier explained in one sentence each: *Playing on this device only*; *This device is registered: cloud saves, forum posting, online play*; *Linked to <provider>: publishing*), *Linked accounts* (ChatGPT behind `auth.openaiWeb`, wallet/Thirdweb behind `auth.thirdweb`; unlink refused when it would orphan the profile, C12 rule 3). The shipped publishing path is the player's own agent plus device-code login, so the page offers "Approve a device code" (→ `/link`) before any provider button [spec/03 D-05].

**Saves page.** One card per save profile: name, created, `playtimeSec`, last save status, device id suffix. Actions: switch, rename, delete (tombstone; type the name to confirm; warns that cloud copies are deleted too), export (`SaveService.exportProfile` → `.dvsave`), import (`asNew` default, `replace` into a chosen profile after a summary of records and a danger confirm), undo import (shown for the profile whose `importedFrom` is set). Slots list with sizes; usage bar against `SAVE_LIMITS.profileMaxBytes` (16 MiB). Every `SaveErrorCode` has a message key and an action (`QUOTA` → "Free up storage" opens Settings › Install & storage; `TOO_LARGE`; `CHECKSUM` → "Loaded the previous save"; `CONFLICT`; `NEWER_SCHEMA`; `IDB_UNAVAILABLE` → in-memory banner; `NOT_ALLOWED` is a bug and is reported with diagnostics; `INVALID`; `NAME_TAKEN`; `PROFILE_LIMIT`).

**Conflict choice (C05 rule 10, M12a).** For each entry in the `conflicts` store show two columns (This device, Cloud) with `savedAt`, `playtimeSec`, device, slot, then three actions: *Keep this device's* (re-PUT with the server version), *Keep cloud's*, *Keep both* (the cloud copy is imported as a new save profile "<name> (cloud)"). Nothing is overwritten silently [spec/11-decision-log.md Q-BE-06]. A banner on every menu page links to unresolved conflicts.

**Multi-tab (C05 rule 9).** The losing tab shows "This profile is open in another tab" and disables Play and save actions.

**Account pages** (`/account/*`, `/link`; non-isolated, plain HTML + Preact island, no game canvas) [spec/03 D-01]:
- `/account/register` (M12a): explains what registering does, shows the Turnstile widget (UNVERIFIED under this page's headers), posts route 7, returns to `/`.
- `/link` (M13c): input for the 8-character code `XXXX-XXXX` (case-insensitive), shows the requested scope `mods:publish` and the warning "Only approve if you started this on your own computer", then calls route 10 approve (P1). Success and expiry (600 s) states; the CLI side is S12's.
- `/account/link?provider=…` (M13c flagged, M14a): redirects through the Worker's start route; return handled by the callback; merge request screen when the subject already belongs to another profile (choose the surviving profile; unlock sets are unioned) [research/auth-ugc-input-maps.md §1.4 rule 2].
- All use redirects, never popups. Redirect sign-in inside an iOS Home Screen app is UNVERIFIED (U-BE-16), so the device-code route is offered first.

### 2.8 Character creator (R-UI-01)

**Flow.** Profile name → creator → intro. Entry points: New Game, Profile › Edit appearance, safehouse wardrobe (outfit tab only). Flat-only (XR shows "Exit VR to continue", DN-S10-04).

**Screen.** Left: preview on the shared canvas through `MenuScene` (turntable; drag/touch-drag or `UiLeft/UiRight` on the focused preview rotates; zoom presets Full body / Head; no auto-rotate under reduced motion). Right: tabs **Body**, **Face**, **Hair**, **Outfit**, **Voice**, **Style**, **Name**. Each part tab is a grid of preset cards (portrait `AssetRef`, title) with slider rows for continuous fields. Footer: Randomize, Reset, Undo/Redo (20 steps), Done.

**Content** (design values for the first kit; counts follow gamedesign §7.1): 12 body presets, 24 face presets with morph sliders (≤ 24 morph ids, each −1…1), 12 skin tones, 16 hair styles × 12 hair colors, outfit slots top (12), bottom (8), shoes (6), accessory (8, optional), 8 synthetic voices with a pitch slider, fight styles as defined by S07. Parts carry a `starter` tag for the first choice set; later outfits unlock through the wardrobe (`CoreSlice.inventory.wardrobe`). Voices are synthetic or designed only, never a clone of a real person (R-NPC-04, D-23). No photo upload exists in v1; a "custom look" path through the fal pipeline is deferred to M10 and may only produce `fictionalized` output.

**Rules.**
1. The saved value is `PlayerAvatar` (§4.1) in `CoreSlice.avatar` via `UiCommand save.avatar`; it is validated by `avatar.v1.schema.json` on load. An unknown or retired part id loads the slot's default part and logs `ui.avatar.fallback` locally; the avatar never fails to load.
2. Name rules: NFC, trimmed, 1–24 characters, letters, digits, space, `-`, `'`, `.`, `_`; the default callsign is read from `content/ui/creator/defaults.json` (never hard-coded). Online display uses `avatar.name`; server moderation applies to names shown to others.
3. The preview builds one skinned mesh set on `bay_rig_v1` with morph targets; budget ≤ 40k triangles and ≤ 3 textures at 1,024 px on `mobile` (design value †). Parts resolve through C07 variants (`VARIANT_FALLBACK`) like any asset.
4. `AppearanceV1` (§4.2) is produced by the same module for C11 `EV Joined`/`Appearance`.
5. Creator parts are C07 assets: `character/pc-<slot>-<id>` for meshes and `portrait/pc-<slot>-<id>` for cards (assumption on S05; listed in `unverified`).

### 2.9 Settings (R-UI-02, R-ENG-04)

Layout: category list left (top tabs on compact), page right. Each row shows a scope badge (*This profile* / *This device*). Changes apply live; profile-scoped changes are debounced 500 ms into `UiCommand save.settings`; device-scoped ones go to `PlatformSettings` (S11) or `UiPrefs` (§4.3). A "Reset category" action exists on every page. Every setting is a `ScreenDef` widget (XR-capable) except Controls capture and the touch layout editor.

| Category | Controls | Storage |
|---|---|---|
| **Graphics** | Quality: Auto or a flat tier valid for the device class; Compatibility mode (force WebGL2, needs reload); FPS cap Auto/30/60; Render scale Auto/0.5/0.65/0.8/1.0; Foveation (headsets only); Data saver; "Re-run benchmark" (3 s, at a safe point); live info lines (current tier and why, backend, memory-pressure notice); FPS counter toggle | `PlatformSettings` (device) [11-platform.md §4.6]; counter in `UiPrefs` |
| **Controls** | Device tabs: Keyboard & mouse, Gamepad, Touch, VR (read-only until M11b2). Per context group (On foot, Vehicle, Fighter, Phone/Map/Camera): action rows with up to two bindings; **Rebind** uses `InputRouter.rebindCapture(device, 5000)` ("Press a key…", Esc cancels); chord support; conflict dialog (Swap / Replace / Cancel); Reset row/group/device; `client.Pause` shows a lock ("always available", C03 rule 9). Hold-to-toggle list; look sensitivity per device; invert Y; deadzones with a live stick preview; touch: layout, tilt steering (opt-in), stick radius, opacity, **Edit layout**; fighter scheme Classic/Simple | C05 `ControlsSettings` (profile) |
| **Audio** | Sliders for the eight buses (master, music, sfx, ambience, voice, radio, ui, cutscene) with a Test button per bus | C05 `audio` |
| **Subtitles** | On, size M/L/XL, background, speaker names; live preview line; sound captions toggle | C05 `subtitles`; captions in `UiPrefs` |
| **Accessibility** | Reduced motion (initialised from `prefers-reduced-motion: reduce` when the profile is created) [MDN, 2026-10-18]; HUD palette Default/Deutan/Protan/Tritan with swatches and shape legend; Timer scale ×1/1.25/1.5/2; Auto-block in story fights; Pause on tycoon events; UI scale 85–150 %; High contrast; Focus ring size; HUD scale/opacity/safe margin; Units mph/kph; Tips on/off; Screen-reader announcements | C05 `accessibility`; the rest `UiPrefs` |
| **XR comfort** | all `XrComfortSettings` fields: locomotion, turn, snap angle (30/45°), smooth speed (1–6 m/s), quantized velocity, vignette (off/low/medium/high), comfort assist (0–1), seated, dominant hand, cockpit horizon lock, chase view, arena scale, hands enabled, UI distance (0.8–2.0 m); height calibration is done in the headset. Shown when the device is XR-capable, else a collapsed note | C05 `xr` (profile) [11-platform-xr.md §4.2] |
| **Camera** | Default fp/tp, FOV (clamped to the range S01 publishes; fallback 60–100°), shoulder L/R, shake (forced off while reduced motion is on) | C05 `camera` |
| **Language** | Language list from `content/ui/i18n/manifest.json` (v1: English only, structure ready); pre-profile pages follow `UiPrefs.lang` then `navigator.languages` | C05 `language` / `UiPrefs` |
| **Data & privacy** | Diagnostics and Gameplay analytics toggles (events dropped client-side when off); Camera features toggle and a camera explainer link; export profile; import; "Export my account data" (route 14); **Forget me** (`IdentityService.forget()`, type-to-confirm, explains what is deleted on server and device); delete local data; read-only age status ("Attested 18+ on <date>") | `PlatformSettings.telemetryConsent` (device); C05 `privacy`; identity |
| **Install & storage** | Install button (Chromium) or iOS steps; storage `usage/quota/persisted`; pack and cutscene sizes; "Download San Francisco for offline (≈ N MB)" needing free quota ≥ 1.2 × N; "Clear downloaded data"; cutscene "Keep offline" cap | S11 `WorldPackStore.usage/downloadAll/clear` [11-platform-pwa.md §5] |
| **Mode options** | One section per mode that supplies `GameModeUI.settingsPanel()` (racing assists, fighter training toggles, tycoon difficulty), rendered as `ScreenDef` | mode slice (S06–S08) |
| **About** | Build id, version, tier decision (copy as JSON), update status ("Update ready" → apply at a safe point), Developer options toggle (loopback `?devmod=` for S12, default off), licences, Reset UI preferences | `UiPrefs` |

Notes. (1) `camera` privacy: the Camera features toggle gates the pose mode only; it never starts a camera by itself (R-IP-04). (2) `reducedMotion` mirrors into `XrComfortSettings.reduceMotion` in the same write (S11 field comment). (3) Changing the tier in a mode applies at the next safe point and the row says so (`QualityService.setTier` is honoured only then). (4) Per-knob graphics overrides are not offered (`DN-S10-06`).

### 2.10 Garage and NPC builder

**Garage (frame M04b2, mod shop M07b).** Grid of `core.garage` entries (S06 `VehicleInstance`; S10 reads `key`, `prefab`, `class`, `nickname`, `plate`, `damage`, `vehicleHeat`, `impoundStrikes` defensively and ignores the rest). Card: name from the prefab's `titleKey`, class chip (D, C, B, A, S, R), damage bar with text, heat icon with number, impound strikes. Detail: preview through `MenuScene` with the prefab's `render.asset`. Actions in the menu: *Set as favourite* (`garage.favorite`). Actions in the world (phone Garage app): *Call to my location* (`garage.call`, shows cost and ETA from the sim). Mod shop, respray and upgrades happen at a safehouse garage or shop through the interaction system with the S06 view mounted in the shell. Header shows "Garage slots used/total" per owned safehouse (2/4/6). Empty state: "You don't own a vehicle yet".

**NPC builder (M06b; flat-only; gate: flag `npc.builder`, online, 18+ attested; submit needs `linked`).** `GET/PUT/POST /api/v1/npc-builder/*` (route 33; payloads owned by S04) [research/ai-npc-runtime.md §6]. List page **My NPCs**: cards with a state chip (`draft`, `validating`, `rejected`, `soul_ready`, `assets_queued`, `private`, `in_review`, `published`, `changes_requested`, `unpublished_pending_review`), limits line (3 drafts anonymous, 10 signed in), "New NPC". Nine steps in a stepper; each step autosaves the draft (`PUT drafts/:id`, debounced 800 ms):

| Step | Fields and behavior |
|---|---|
| 1 Basics | name, one-line pitch, archetype, district (from `content/districts.json`, S02) |
| 2 Backstory | textarea ≤ 20,000 characters with live count; import `.md`/`.txt` read locally |
| 3 Reference images | ≤ 6 images, crop, **manual cover tool** (user draws rectangles); upload via route 34. **No automatic face detection runs in the client**: R-IP-04 and DN-S05-3 remove face analysis, so the research's "face-blur preview" is replaced by the manual tool and by the guidance "use art, outfits, places and mood boards; photos of real people need written consent" |
| 4 Likeness attestation | radio: original / self / real person with written consent; consent document upload only for the last; copy explains that a suspected real person is forced to `fictionalized` and that images become style references only [research/ai-npc-runtime.md rec 15] |
| 5 Soul review | generated soul as an editable, diff-style form; lint results inline; "Regenerate" (1 per draft per hour; shows the remaining wait) |
| 6 Voice | catalog picker; "design a voice" prompt for signed-in 18+ players (tier t2) |
| 7 Preview chat | SSE chat with the draft (20 turns per day), persistent "AI character" badge, remaining-turns counter, `fallback` events shown as in-character offline lines |
| 8 Character sheet | pipeline status (`assets_queued → assets_ready`) polled every 5 s (backoff to 30 s) while visible; 3D preview through `MenuScene` once ready |
| 9 Submit | requires `linked`; otherwise a CTA to link; shows `in_review` and reviewer notes for `changes_requested` |

Rules: (1) `rate_limited`/`quota_exhausted` show the wait from `retryAfterMs`, never a raw error. (2) A `moderation_blocked` result shows one fixed message plus the content policy link; classifier details are never shown. (3) Everything the player types is rendered as text, never as HTML. (4) "Use in my sandbox" spawns a private NPC only in the sandbox mode (private NPCs never enter the story). (5) The report button (§2.11) appears on every published NPC card.

### 2.11 Forum UI (R-MOD-03, R-IP-03; M13b; flat-only)

Pages: boards (from `forum_boards`; boards with `min_tier` above the player's tier show a lock and CTA) → thread list (title, author display name, score, post count, last post time, `locked` chip; sort *new*/*top*; search box only if S09 exposes `q`) → thread view (posts oldest first; polls `GET …/posts?since=` every 15 s while the thread is open and the page visible) → compose (title 3–120, body 1–10,000 characters; attachments through route 34 with `purpose: forum_attachment`, count limit from S09, default ≤ 3). Votes: ▲/▼ with the current value; `PUT /forum/votes` with −1, 0 or 1 [09-backend-db.md §3.7].

Rules: (1) Posting needs `device` tier, account age ≥ 72 h and 18+ attestation (Q-BE-04); otherwise the composer is replaced by an explanation and the right CTA. (2) `rate_limited` shows a countdown (1 post per 30 s; 20 per day for new accounts) [09-backend-ops.md §3 RL_FORUM]. (3) Thread and post states: `held` → author sees "Waiting for review", others see nothing; `removed` → tombstone line; `locked` → no composer. (4) **Report** (`POST /api/v1/reports`, `ReportReq`) is a button on every thread, post, attachment, experience, mod, published NPC and AI chat turn; category list = `ReportCategory`; `copyright` redirects to `/legal/dmca` (the API returns 409 with that redirect) [09-backend-contracts.md §2.5]. (5) User text is always rendered as text nodes; there is no markdown or auto-linking in v1; images load only from `ugc.<domain>` with `crossorigin="anonymous"` (COEP). (6) A thread linked to an experience shows an experience card with "Show on map".

### 2.12 Experiences and mods (R-MOD-04; M13a; flat-only)

**Experiences.** List from `GET /api/v1/experiences?bbox=` (route 37), filters by neighborhood and rating, detail with name, author display name, rating (`sum/count`), radius, anchor neighborhood. Only `moderation = published` and `visibility = public` items are listed to others (server-owned fields are read-only, C17). Actions: **Show on map** (opens the phone Map app focused on the marker), **Play** (enters through the marker in the world), **Report**. Before first entry a one-time notice: "Experiences run in a sandbox. Progress here doesn't affect your story. Online play is unavailable while mods are active" (C11 close 4007 when `modsActive`). A map view built with MapLibre on this page is out of scope in v1 (second WebGL context risk on iPhone); spatial browsing uses the in-engine map (D-25).

**Mods.** Tabs *Explore* and *Installed* [research/repos-grand-v.md §6 rec 9]. Explore: search, kind filter (`experience`, `vehicle`, `character`, `rules`), sort; cards show name, author, kind, tier, version. Detail lists permissions from the closed `permissions[]` enum as plain sentences (`perm.<id>` keys; an unknown value shows "can't install" because publish fails closed, 06 §4.4). `tier: 'ui'` shows "This mod can show its own windows". Install shows a per-step log and a three-line toast; Installed: enable/disable, remove, "update available". Mods are disabled while a multiplayer room is active (C14).

### 2.13 Play online (R-ROLL-02; M12b/c)

Page `online` (flag `mp.enabled`, tier ≥ `device`): *Join a room* (route 23 `assign {district:'sf', modsActive}`; if `modsActive()` is true the button is replaced by "Turn off mods to play online"), *Enter invite code* (6 characters, base32), *Create invite* (route 25: code, 10-minute countdown, copy), room status (route 22: players/capacity), presence of friends (M12c). Close codes 4001–4008 map to message keys; 4007 is "mods are active". Chat is a separate panel, default off, 18+ only, with a report button (C §2.10). Online play never pauses the sim: Pause and Phone become non-pausing overlays when `ctx.net` is non-null.

### 2.14 Credits, legal, help

**Credits** is generated: `credits.json` is a build artifact produced by `provenance:check` from every `ProvenanceRecord` attribution plus `license:scan` output [research/legal-ip-likeness.md §2.5 table row `provenance:check`]. Sections: Team; Data and maps (OSM ODbL "© OpenStreetMap contributors", DataSF PDDL credit, Terrarium and USGS credits [research/legal-ip-likeness.md §5 map licences]); Audio and music; Fonts (OFL-1.1); Open-source licences; **AI disclosure** (which parts are generated, vendors named; community trust and L-R22); **Characters** (each NPC's tier disclaimer: *Parody. Not affiliated with or endorsed by any real person.* / *Fictional character.* / *Appears courtesy of <name>*) [research/legal-ip-likeness.md likeness table]; the fixed non-affiliation disclaimer from `BRAND.disclaimer`.

**Legal** pages (`/legal/:doc`, public, no gates): Terms, Privacy, DMCA (form → route 42), NCII/Take It Down, UGC policy, Parody and AI disclosure, Repeat-infringer policy, Contact. Forms post to `/api/v1/legal/*` (worldwide, geo-exempt). Field sets follow counsel's text (M13d). A stub renders in M00.

**Likeness and AI labels in play** (components in C §2.10): the `LikenessCard` on first sight of a parody or fictionalized NPC, a persistent "AI character" badge in dialogue, an "AI-generated" chip on generated cutscenes [research/legal-ip-likeness.md §5.2, L-R22].

**Help / troubleshooting.** `content/ui/help/troubleshooting.json` (schema §4.4) rendered as groups in tabs; each topic is a collapsible header (first open) with numbered steps; "Guide updated <date>"; a translated guide is used only when its `updated` equals the English file's [research/repos-grand-v.md §2(g), rec 17]. Topic ids are deep-link targets from error screens. "Copy diagnostics" is local only (no upload in v1).

## 4. Data

### 4.1 `PlayerAvatar` (stored in C05 `CoreSlice.avatar`; schema `packages/shared/schemas/ui/avatar.v1.schema.json`, owner S10, kept in `@dv/shared` with the wardrobe-item schema so `@dv/mod-sdk` can re-export them without Preact)

```ts
export type PartId = string;                          // /^[a-z0-9][a-z0-9._-]{1,62}$/, key into creator catalog
export type MorphId = string;                         // catalog morph id, ≤ 24 per avatar
export interface PlayerAvatar {
  v: 1;
  name: string;                                       // 1–24, see §2.8 rule 2
  callsign: string;                                   // default from content/ui/creator/defaults.json
  body: { preset: PartId; height: number /*0..1*/; build: number /*0..1*/ };
  face: { preset: PartId; morphs: Partial<Record<MorphId, number /* −1..1 */>> };
  skinTone: number;                                   // index into catalog.palettes.skin
  hair: { style: PartId; color: number };             // color = index into catalog.palettes.hair
  outfit: { top: PartId; bottom: PartId; shoes: PartId; accessory?: PartId };
  voice: { id: PartId; pitch: number /* −1..1 */ };   // synthetic voices only
  fightStyle: PartId;                                 // S07 style id
  customLook?: { pipelineJobId: string; tier: 'fictionalized' };   // reserved for M10; absent in v1
}
export type CreatorSlot = 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory' | 'voice' | 'fightStyle';
export interface CreatorPart { id: PartId; index: number /* u8 ≥ 1, unique per slot, append-only, never reused */; titleKey: LocKey;
  model?: AssetRef; portrait?: AssetRef; tags: string[]; unlock?: UnlockEventId; retired?: boolean }
export interface CreatorCatalog { v: 1; rev: number /* u16, +1 per catalog change */; slots: Record<CreatorSlot, CreatorPart[]>;
  palettes: { skin: string[]; hair: string[] }; morphs: { id: MorphId; index: number; titleKey: LocKey; target: string }[]; defaults: PlayerAvatar }
```
Differences from the gamedesign sketch: palette indices replace free hex colors (so the value fits `AppearanceV1`), and `customLook` is reserved, not active.

### 4.2 `AppearanceV1` (binary, little-endian; fixed obligation, 06 §4.3; sent base64 in C11 `EV Joined`/`Appearance`)

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | version = 1 |
| 1 | u8 | flags (bit0 accessory present) |
| 2 | u16 | `catalogRev` |
| 4 | u8 ×4 | body.preset index, body.height (0–255 ↔ 0…1), body.build, face.preset index |
| 8 | u8 ×3 | skinTone, hair.style index, hair.color |
| 11 | u8 ×4 | top, bottom, shoes, accessory (0 = none) indices |
| 15 | u8, i8, u8 | voice index, pitch (−127…127 ↔ −1…1), fightStyle index |
| 18 | u8 | morph count n (≤ 24) |
| 19 | n × (u8 morphIndex, i8 value) | face morphs |

Total 19 + 2n ≤ 67 bytes (base64 ≤ 92 characters), far under the 512 B limit. Decoder rules: length must equal 19 + 2n; an unknown version returns the catalog default; an index above the local catalog or retired renders the slot default; the encoder and decoder are pure functions in `packages/ui/src/creator/appearance.ts` with golden vectors. Names travel separately in `Joined.name`.

### 4.3 `UiPrefs` (device-scoped, IndexedDB `dv-ui` store `prefs`, every access in try/catch with in-memory fallback)

```ts
export interface UiPrefs {
  v: 1; lang: string | null; uiScale: number /*0.85..1.5*/; highContrast: boolean; focusRing: 'default' | 'thick';
  hudScale: number /*0.8..1.4*/; hudOpacity: number /*0.4..1*/; hudSafeMarginPct: number /*0..10*/;
  units: 'mph' | 'kph'; showTips: boolean; announce: boolean; showFps: boolean; soundCaptions: boolean;
  seenTiles: string[]; dismissed: string[] /* coach marks, hints, one-time notices */;
  customTouchLayouts: Record<string /* 'custom:1'…'custom:4' */, TouchLayout>;
  age: { attested: '18p' | null; attestedAt: number | null; blocked: boolean };
  terms: { version: string; acceptedAt: number } | null; developer: boolean;
}
```
Why device-scoped: text scale, HUD scale and touch layouts depend on the screen, so syncing them with a profile would be wrong; accessibility values that are profile-wide stay in C05 `accessibility`. A custom touch layout id referenced from `ControlsSettings.touch.layout` that is missing on another device falls back to the default layout.

### 4.4 Troubleshooting guide schema

```ts
export interface TroubleshootingGuide { version: 1; updated: string /* YYYY-MM-DD */;
  groups: { id: string; title: LocKey; topics: { id: string; title: LocKey; steps: LocKey[] }[] }[];
  sources: { title: string; url: string }[] }         // only URLs present in research/INDEX.md §2
```
Groups: Install and updates, Performance, Graphics and crashes, Audio, Controls and gamepads, Saves and storage, VR, Online and account.

## 5. Runtime behavior (pages)

1. Every page is a lazy chunk; the first paint of `main` needs only the shell, kit and `main` chunks.
2. Navigation pushes a `PageFrame`; leaving a page releases focus groups and input contexts (tested).
3. `apiErrorToUi()` table: `unauthorized/forbidden/tier_required` → CTA; `age_blocked` → age explanation (not a retry); `region_blocked` → online pages hidden; `build_mismatch` → "Update the game" with `applyNow` at a safe point; `rate_limited/quota_exhausted` → wait text; `moderation_blocked` → policy message; `internal` and network failure → inline retry.
4. Optimistic UI is limited to votes; all other writes show a pending state and the final server result.

## 6. Platform notes (pages)

Desktop: full keyboard shortcuts (Esc back, Tab/Shift+Tab, Enter, arrows). iPhone: pages work in portrait; creator and builder use a single column with sticky action bars; OS keyboard avoids covering the focused field via `visualViewport` adjustments (UNVERIFIED behavior in standalone). Quest/Vision Pro: `ScreenDef` pages (main, modes, load, saves, settings, phone apps) render as panels; flat-only pages show the exit panel; settings in XR omit native file import/export and Controls capture until M11b2.

## 7. Verified facts used

| Fact | Source |
|---|---|
| Neutral age screen, COPPA block of under-13, 17+ recommendation, AB 1043 signals from 2027-01-01, camera consent flag | [research/legal-ip-likeness.md §5.3, §P3–P4] |
| Report button on every UGC surface; AI disclosure; parody/fictional disclaimers; persistent AI-character badge | [research/legal-ip-likeness.md §5.2, §5.3, likeness table, L-R22] |
| Save profiles: 32-hex, names 1–80, ≤ 64, Story/Sandbox namespaces, export/import/undo, last-save status | [research/repos-grand-v.md §2(d)]; C05 |
| Troubleshooting schema, first-open collapsible, "Guide updated <date>" | [research/repos-grand-v.md §2(g), rec 17] |
| Mod store UX: Explore and Installed, per-step install log | [research/repos-grand-v.md rec 9] |
| NPC builder flow, limits and API | [research/ai-npc-runtime.md §6] |
| `prefers-reduced-motion: reduce` is Baseline widely available since January 2020 | developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion, 2026-10-18 |
| Forum tables, limits, polling every 15 s, RL_FORUM | [09-backend-db.md §3.7; 09-backend-ops.md §3] |

## 8. Milestone mapping (pages)

See part A §8. Within M04b1: shell and kit first, then Title/Age/Terms, Main, Load/Saves/Profile, Modes (stubs), Settings (Graphics, Controls kbm/pad, Audio, Accessibility, Camera, Language, Privacy, Install, About). Within M04b2: Creator, New Game, Garage frame, Help, then the part C items. Stubbed first: Community, Experiences, NPC Builder, Online are registered pages that render a "Coming soon" screen until their milestones (A-06 pattern).

## 9. Tests

1. `age-gate.spec.ts` (unit + e2e `@ui-age`) — field order follows locale; no threshold text; 17-year-old date → `BlockedPage`; relaunch still blocked; no network request and no telemetry from a blocked session; 18th-birthday-today passes; invalid date allows retry. `pnpm check:unit -- packages/ui`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-age`
2. `modes-tiles.spec.ts` — table-driven: each state in §2.6 from a fixture registry; `comingSoon` is focusable and not activatable; unlock event raises one toast and a NEW badge; `?unlockAll=1` ignored when `VITE_DV_QA` is unset. `pnpm check:unit -- packages/ui`
3. `saves-ui.spec.ts` — every `SaveErrorCode` has a message and action; conflict dialog calls the three resolutions; second tab goes read-only. `pnpm check:unit -- packages/ui`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-saves`
4. `creator.spec.ts` — avatar validates against the schema; unknown part falls back; `AppearanceV1` golden vectors encode/decode; length ≤ 512 B for 24 morphs; saved avatar reloads identical after reload (`@creator` e2e). `pnpm check:unit -- packages/ui`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @creator`
5. `settings-bind.spec.ts` — each control writes its scope (profile → `save.settings`, device → `PlatformSettings`/`UiPrefs`); controls remap round-trips through `InputRouter.setOverrides`; Pause cannot be unbound. `pnpm check:unit -- packages/ui`
6. `report-everywhere.spec.ts` — every UGC component type renders `ReportButton`; `copyright` navigates to `/legal/dmca`. `pnpm check:unit -- packages/ui`
7. `forum.spec.ts` (M13b) — polling pauses when hidden; `held`/`removed` rendering; user text never reaches `innerHTML` (lint rule `no-inner-html` over `packages/ui`). `pnpm check:unit -- packages/ui`
8. `npc-builder.spec.ts` (M06b) — step autosave, limits messages, no face-detection import (dependency lint), submit gated on `linked`. `pnpm check:unit -- packages/ui`
9. `help.spec.ts` — stale translation falls back to English when `updated` differs; every error kind maps to an existing topic id. `pnpm check:unit -- packages/ui`
10. Device checklists (manual, M04b2/M11a): iPhone Safari tab and Home Screen — coach mark, safe areas, keyboard over fields; scripted file `tools/ci/checklists/M04b-iphone.json`.

## 10. Open questions

DN-S10-01…06 (part A §10). Q-02 (age rating) and Q-06 (tone) from `spec/00-plan.md` govern copy. UNVERIFIED items 1–9 of part A §10 apply to this part.
