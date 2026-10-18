# ADR-0030 — UI-mod L1 network-origin host

**Status:** proposed (conditional; written only if L0 fails the M13a5 matrix) · **Date:** 2026-10-18 · **Decides:** DL-104 (`BootConfig.hosts.modsUi` absent), DL-146, DN-S12-02

## Context
The game page is cross-origin isolated, so a child frame must be COEP-compatible. UI mods (tier `ui`) run in a `sandbox="allow-scripts"` frame without `allow-same-origin`, which gives an opaque origin. The primary design (L0) uses a `srcdoc` document, which inherits its parent's policy container, so no network response is checked (HTML Standard, see `12-modding.md` §2.5). Whether L0 behaves as designed on iOS Safari 26 standalone, Quest Browser and visionOS Safari is UNVERIFIED (S12 U2). `credentialless` iframes do not exist in Safari [research/repos-modding.md].

## Options considered
1. **L0 `srcdoc` only** (primary; ships behind `mods.ui`).
2. **L1: a separate network origin** (`BootConfig.hosts.modsUi`) serving `ui.html` with `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: cross-origin` and a CSP `sandbox allow-scripts; default-src 'none'`. A same-site host may share a renderer process; a different registrable domain isolates fully but costs a domain and a zone.
3. **L2 declarative panels only** (`dv-panel/1` rendered by the host; always available and mandatory in XR).

## Decision (proposed)
The M13a5 matrix (Chromium, iOS Safari 26 standalone, Quest Browser, visionOS Safari) decides:
- If L0 passes on all four: L0 ships, this ADR is closed as not needed, `modsUi` stays absent.
- If L0 fails somewhere: write the L1 decision here (same-site host first; a separate registrable domain only if the Spectre review, S12 U3, requires it), add the optional `hosts.modsUi` field as an additive C12 change through the Architect, and keep `mods.ui` off for the failing platforms.
- If both fail: the `ui` tier ships as L2 only.
Until then `BootConfig.hosts.modsUi` is absent and `mods.ui` is off.

## Consequences
- (+) No extra domain, zone or host unless evidence demands it.
- (+) L2 remains a safe floor on every platform, including XR.
- (−) A late L1 requires a new host deployment and a C12 minor bump after M13a5.
- (−) Renderer-process separation of sandboxed same-site frames is UNVERIFIED (S12 U3).

## Affected contracts and milestones
C12 (`BootConfig.hosts`), C14 (`ui` tier, `dv-panel/1`). M13a5 (matrix), M13a7 (store pages), M11b3 (XR panels use L2).

## Links
`spec/domains/12-modding.md` §2.3, §2.5; `09-backend-contracts-1.1.md`; `spec/11-decision-log.md` DL-104, DL-146; ADR-0012, ADR-0020.
