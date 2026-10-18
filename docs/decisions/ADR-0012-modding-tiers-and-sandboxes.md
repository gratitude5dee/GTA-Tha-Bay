# ADR-0012 — Modding tiers and sandboxes

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-26; R-MOD-01, R-MOD-04, R-IP-03; contracts C14, C17

## Context
Players make mods with their own coding agents (R-MOD-01). Untrusted code must not stall the sim, reach the network, read other saves, or run in a multiplayer room. The game page is cross-origin isolated (COOP/COEP), which constrains iframes [ADR-0020]. Publishing needs moderation before visibility (R-IP-03).

## Options considered
1. **SES, Compartments or ShadowRealm for scripts.** ShadowRealm is unshipped; SES cannot pre-empt a loop without killing its worker [research/repos-modding.md §5.2].
2. **Mods in `sim.worker`.** A hostile loop stalls the sim; a separate worker with an interrupt handler bounds it.
3. **Same-origin iframe or `allow-same-origin` for UI mods.** Removes the sandbox.
4. **Server-side mod code or mods in rooms.** Cloudflare Dynamic Workers are beta and need a vetting milestone; rooms stay mod-free in v1.
5. **Three tiers with capability-based hosts** (chosen).

## Decision
- **Tiers.** `data` (JSON Schema, no code; scene ≤ 512 ops, ≤ 256 asset files, archive ≤ 128 MiB), `script` (one ES module ≤ 256 KiB in QuickJS-wasm inside `mod.worker`: no `fetch`, DOM, `Date`, `Math.random`, `performance`, `SharedArrayBuffer`, `Atomics` or `WebAssembly`; interrupt handler, memory and stack limits; host functions only), `ui` (one `ui.html` ≤ 512 KiB in an opaque-origin iframe, or a declarative `dv-panel/1` panel). Kinds: `experience`, `vehicle`, `character`, `rules`; no `mission` kind (missions are data inside experiences).
- **Capabilities.** A mod sees only the `ModContext<P>` namespaces its closed `permissions[]` grant; coordinates are anchor-relative; saves go only to its own `mod:<id>` slot; unknown fields or permissions fail validation (fail closed, fail soft at runtime).
- **Where mods run.** Never in Story and never in a room: `modsActive()` is false in any room session and the server closes 4007 on a client that reports mods (C11). Sandbox sessions load enabled `rules`, `vehicle` and `character` mods; an `experience` runs as `exp:<id>` from a map marker, with `story:auto` written first and restored on exit.
- **UI under COEP.** Ladder behind one `ModUiHost`: L0 `srcdoc` document with our CSP meta (an `about:srcdoc` document inherits the parent's policy container); L2 declarative panel (always available, mandatory in XR); L1 network origin only through ADR-0030. `mods.ui` stays off until the M13a5 matrix (Chromium, iOS Safari 26 standalone, Quest Browser, visionOS Safari) records a pass.
- **Validation.** One pure validator in `packages/shared/src/mod/check/` runs in `dv mod check` and in the publish queue consumer, reusing S05's provenance and IP gate cores; archives are content-addressed by SHA-256 (`ugc/published/<sha256>.zip`).
- **Agent kit.** The mod workspace `AGENTS.md` is capped at 24 KiB because Codex caps instructions at 32 KiB [F-060]; skills are canonical in `skills/` and mirrored, checked by `check:skills`; `thabay-mcp` plus the `dv` CLI.
- **Flags (binding).** `mods.enabled`, `mods.script` and `mods.ui` stay off until M13a3, M13a4 and M13a5 record passing runs; `ugc.publish` stays false in production until M13d1's acceptance criteria pass (DL-151).

## Consequences
- (+) The lowest tier that works gets the lightest review; a runtime fault disables one mod for the session and leaves every save untouched.
- (+) Rooms never see mod code, so a mod cannot become a cheat vector.
- (−) QuickJS cost on iPhone and Quest, and `srcdoc` behaviour under COEP on Safari, Quest and visionOS, are UNVERIFIED (S12 U1, U2); the script tier runs on `mobile-low` only after the M13a4 iPhone spike passes (DL-147).
- (−) Mods in rooms need a later vetting milestone (server-side command validation, allowlisted creators).

## Affected contracts and milestones
C14, C17, C05 (`mod:<id>` slots, `exp:` writes), C06 (`modSurface`, mode switch), C07 (provenance), C11 (4007), C12 (routes 34–37, 53). M13a1–M13a6, M13a7, M13b3, M13c2.

## Links
`spec/domains/12-modding.md` §2; `12-modding-contracts.md`; `12-modding-publish.md`; `research/repos-modding.md`; `spec/11-decision-log.md` DL-084, DL-146, DL-147, DL-151, DL-152; ADR-0017, ADR-0019, ADR-0030.
