# M04a1 — saves-gamemode-unlocks

## Goal
After this session the game can save. `SaveService` (C05 1.1) runs in `sim.worker` on IndexedDB `dv-saves`:
- named save profiles (≤ 64, 32-hex ids);
- one `SaveRecord` per `SlotId`, with canonical JSON, fnv1a64 checksums and size caps;
- two-phase atomic writes (record, verify, pointer compare-and-swap);
- last-good-generation fallback;
- per-session write capabilities, tombstones, ordered pure migrations with golden files;
- `.dvsave` export and import with undo;
- multi-tab detection;
- a `changesSince` feed for M12a1's cloud sync.

The main thread reads the last-save status line through a read-only handle. A killed tab never loses the last good save. **Split boundary (`01-engine.md` §8, row M04a; `_PLAN.md` M04a1/M04a2):**
- M04a1 takes everything in C05: the store, rules 1–9, slice schemas, golden files, export and import, and the `save.request` control message.
- M04a2 takes C06: `ModeHost`, `ModeContext`, the unlock registry, the autosave policy, the economy wallet, controls-remap persistence, and the clock and interaction tests.

## Requirements
- R-MODE-01: the story's progress, wallet, heat and property live in `story:*` slots that survive reloads and crashes.
- R-MODE-05: unlock state persists in `CoreSlice.unlocks` (written by M04a2 through this service).
- R-PLAT-01: the installable PWA keeps progress offline in IndexedDB, with an in-memory fallback banner when storage is unavailable.
- R-ROLL-02 (support): `changesSince` and tombstones are the sync unit for C12 routes 16–19 and 50–51 (M12a1).

## Depends on
- **M01b2** (controller-cameras-touch): `sim.worker` with `SimHost`, the C02 `SimControlMessage` channel, the QA page pattern and the bridge.
- Through it: M01a1 (canonical JSON, `Fnv64`), M01a2 (worker transports), M00 (Playwright projects).
- Contracts: C05 1.1.0, C02 1.1.0 (control messages, rule 9), C03 1.1.0 (`ControlsSettings` type inside `ProfileSettings`), C13 1.1.0 (`XrComfortSettings` type inside `ProfileSettings`).

## Scope in
- `packages/shared/src/contracts/c05-save.ts` copied verbatim, with the 1.1 additions (`SaveReason 'checkpoint'`, `ProfileSettings.npc?`, `.cutscenes?`) and the exported `JsonObject`/`JsonValue` (DL-194). C05 imports types from `c06-modes.ts`, `engine-world.ts`, `c03-input.ts` and `platform/xr-comfort.ts`. Any of these not yet present (and, transitively, `ui-bridge.ts`) is created **verbatim and whole** from its owner section (types only; M04a2 implements C06). A contract file is never created partially.
- The JSON Schema `save-record.v1.json` (C05 envelope) and slice schemas `packages/engine/src/sim/save/schema/{core,settings,story,sandbox}.v1.schema.json`. Mode slices (`racing`, `fighter`, `tycoon`) and `mod:*` are validated as `JsonObject` under the size caps until their owners add schemas.
- `SaveService` in `packages/engine/src/sim/save/` (outside the C02 lint scope, so `Date.now` and `crypto.getRandomValues` are allowed):
  - IndexedDB `dv-saves` v1 with stores `profiles`, `records`, `pointers`, `tombstones`, `conflicts` (created empty; M12a1 fills it), `meta`;
  - rule 1: atomic write with orphan sweep on boot;
  - rule 2: load with fallback;
  - rule 3: capabilities `SaveCapability` (`story`, `sandbox`, `standalone:<mode>`, `exp:<id>` per 1.1);
  - rule 5: migrations registry and golden files;
  - rule 6: tombstones (180-day retention, purge only after a synced mark);
  - rule 7: profiles (NFC names, case-insensitive uniqueness, `PROFILE_LIMIT`);
  - rule 8: import and undo;
  - rule 9: multi-tab, where the losing tab gets a read-only session and `onStatus` reports it;
  - `changesSince(id, cursor)`;
  - `onStatus`.
- Profile and per-record caps: `recordMaxBytes` 2 MiB, `profileMaxBytes` 16 MiB, `QUOTA` mapping from `QuotaExceededError`, and a CI warning when a story golden exceeds `storyTargetBytes`.
- `IDB_UNAVAILABLE` path: an in-memory store with the same API, and `SaveService.persistent === false` for the S10 banner (M04b1).
- Worker plumbing: a `SimControlMessage {t: 'save.request', reason}` handler outside ticks (C02 rule 9). A command port that takes `{slot, data, reason}` writes from sim systems. A main-thread `readLastSave(profileId)` read-only helper (`packages/engine/src/client/save-status.ts`).
- QA bridge `__dvBridge.engine.save.{list, write, load, kill}` (QA builds only) and QA page `apps/web/qa/save-kill.html`, which runs a write loop in `sim.worker` for the kill test.

## Scope out
- `ModeHost`, `ModeContext`, `UnlockRegistry`, the autosave policy (when to call `write`), economy, controls-remap persistence: M04a2.
- Menus, the saves page, conflict UI and banners: M04b1.
- Cloud sync and server conflicts (rule 10): M12a1.
- Story slice content beyond schema v1 (C09 checkpoint data is opaque here): M05a1.

## Deliverables
- `packages/shared/src/contracts/c05-save.ts` (plus any missing imported contract file, created verbatim and whole); `packages/shared/schemas/save-record.v1.json`.
- `packages/engine/src/sim/save/{service.ts, idb.ts, memory-store.ts, write.ts, load.ts, capability.ts, migrate.ts, profiles.ts, tombstones.ts, export-import.ts, multitab.ts, changes.ts, canonical.ts, index.ts}`; `schema/{core,settings,story,sandbox}.v1.schema.json`.
- Golden files `packages/engine/src/sim/save/__golden__/{core,settings,story,sandbox}/v1.json` (the C05 rule 5 path), plus `__golden__/dvsave/sample.v1.dvsave`.
- `packages/engine/src/sim/worker/save-control.ts` (control-message handler); `packages/engine/src/client/save-status.ts`.
- `packages/engine/test/save/{atomic.spec.ts, load.fallback.spec.ts, caps.spec.ts, capability.spec.ts, migrate.golden.spec.ts, tombstone.spec.ts, profiles.spec.ts, import-undo.spec.ts, multitab.spec.ts, changes.spec.ts, memory.spec.ts}`.
- `packages/engine/package.json`: dev dependency `fake-indexeddb` (version as resolved, recorded in `spec/03`); script **`test:save`** (`vitest run test/save`), also run by `pnpm check:unit`.
- `apps/web/qa/save-kill.html`, `apps/web/src/qa/save-kill.ts`; `verify-dist.mjs` also rejects `save-kill`.
- `tests/e2e/engine/save-kill.spec.ts` (`@save-kill`).
- About 37 files.

## Interfaces
- C05 1.1: `c05-save.ts` verbatim; `SaveService` implements the interface exactly. No shape change. A gap goes to the report as a proposal.
- C02 1.1: `SimControlMessage {t: 'save.request'}` handled outside ticks.
- Engine-internal (not contracts): `SaveCapability`, the write port, `readLastSave`, the memory store.

## Acceptance criteria
- AC-1 Given a write When it is interrupted after each of the steps (a)–(f) of C05 rule 1 (fault injection per step) Then the next `load` returns the last good generation with a valid checksum. Orphan records are swept on boot, and at most `keepGenerations` (2) records remain per slot — proof: `pnpm --filter @dv/engine test:save`
- AC-2 Given a pointer whose record has a corrupted checksum When the profile loads Then the previous generation is used, `lastSave.error` is `CHECKSUM`, and the stored records are unchanged byte for byte — proof: `pnpm --filter @dv/engine test:save`
- AC-3 Given caps When a 2 MiB + 1 B record, a profile total above 16 MiB, a 65th profile and a duplicate name differing only in case are written Then each returns `TOO_LARGE`, `TOO_LARGE`, `PROFILE_LIMIT` and `NAME_TAKEN`, and nothing is stored — proof: `pnpm --filter @dv/engine test:save`
- AC-4 Given a `sandbox` session capability When it writes `story:auto` or `core` Then the result is `NOT_ALLOWED`. A `standalone:racing` session may write only `core`, `settings` and `mode:racing`, and an `exp:<id>` session only its own `mod:<ModId>` — proof: `pnpm --filter @dv/engine test:save`
- AC-5 Given the golden files for every slice kind When the migration suite runs Then every golden loads through the registry and validates against its schema. A record with `schema` above the build's loads read-only with `NEWER_SCHEMA`, and a throwing migration leaves the stored record untouched and loads the previous generation — proof: `pnpm --filter @dv/engine test:save`
- AC-6 Given a deleted slot with a tombstone When an import brings an older record for that slot Then the slot stays deleted. Tombstones older than 180 days are purged only when marked synced — proof: `pnpm --filter @dv/engine test:save`
- AC-7 Given an exported `.dvsave` When it is imported `asNew`, then `replace` into another profile, then `undoImport` runs Then `asNew` creates a profile with equal slot data, `replace` moves the pointers and stores `importedFrom.undoGen`, and undo restores the previous generations exactly. A record that fails the schema rejects the whole import with `INVALID` — proof: `pnpm --filter @dv/engine test:save`
- AC-8 Given two service instances on the same profile When both write the same slot Then exactly one succeeds, the other gets `CONFLICT` and switches to read-only, and `onStatus` reports it — proof: `pnpm --filter @dv/engine test:save`
- AC-9 Given IndexedDB throws on open When the service starts Then it runs on the memory store, `persistent` is false, and writes and loads still pass the rule 1–3 tests — proof: `pnpm --filter @dv/engine test:save`
- AC-10 Given the QA build When `/qa/save-kill.html` runs a write loop and the test closes the page mid-loop, then reopens it Then the last good generation loads, its checksum is valid, and the status line read on the main thread matches it — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @save-kill`
- AC-11 Given the branch When the standard gates, the dist verifier and the preview deploy run Then all pass, and the production `dist/` has no `save-kill` page — proof: `pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm --filter @dv/engine test:save`, under `pnpm check:unit`, with `fake-indexeddb`): `engine/save.atomic`, `save.loadFallback`, `save.caps`, `save.capability`, `save.migrateGolden`, `save.tombstone`, `save.profiles`, `save.importUndo`, `save.multitab`, `save.changes`, `save.memory`.
- **E2E:** `@save-kill` on `chromium-webgl2`. WebKit IndexedDB durability under process kill (U-ENG-9) is recorded on the device in M11a1, never asserted here.

## Demo script
1. `pnpm dev`, open the console, run `__dvBridge.engine.save.list()`: one default profile.
2. `__dvBridge.engine.save.write('sandbox', {...}, 'manual')`, reload, then `load`: the data is there with `gen` 1.
3. Open `/qa/save-kill.html` and close the tab mid-loop; reopen: the status line shows the last good save.
4. Export the profile, import it as new, then undo.

## Effort
1 Builder session; about 37 files; risk **medium**. IndexedDB transaction semantics and the fault-injection harness take the time.

## Risks & fallbacks
- **IndexedDB commit durability under a killed process** (U-ENG-9): the two-phase write is safe either way (C05 rule 1). Record behaviour in M11a1's soak; never assert it.
- **`fake-indexeddb` differs from browsers.** Every rule with a browser-specific edge (rule 1 kill, rule 9 tabs) also has an e2e or is listed for M04b1's `@ui-saves`.
- **Missing contract files imported by C05.** Create them whole and verbatim from their owner sections. If one cannot compile, record a proposal and stop on that file; never edit a shape.

## Notes for the Builder
- Read first: `01-engine-save-modes.md` §C05 and "C05 1.1 and C06 1.1 additions"; `01-engine.md` §2.10 and §9 tests 14–15; `research/repos-grand-v.md` §(d) for the profile behaviour cited there; DL-194, DL-195.
- Facts: F-009 (WebContent killed near 2 GB, which is why recovery matters), F-010 (origin quota; `QUOTA` mapping).
- Order of work: contract file, canonical and checksum, IDB layer, atomic write and load, caps, capabilities, profiles, tombstones, migrations and goldens, export and import, multi-tab, memory store, control message, QA page and e2e.
- Goldens live only in `packages/engine/src/sim/save/__golden__/` (C05 rule 5; `_PLAN-1.md` aligned, DL-220).
- `sim/save/**` is outside the determinism lint by design. Nothing in it may be imported by sim systems except through the write port.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate.
