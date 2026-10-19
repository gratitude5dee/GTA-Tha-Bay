# M01e device run: iPhone 15 Home Screen app (AC-11)

Status: **NOT RUN** (device check pending, Q-13). No `notes.json` is committed until the operator runs this.

What it answers: whether the world-pack store (OPFS `dv/packs/<sha256>.bin` plus IndexedDB `dv-packs`) survives closing the Home Screen app from the app switcher, and what `navigator.storage.persist()` and `estimate()` report there and in a Safari tab. It records observations only; it asserts no durability rule (U-PLT-16, F-010 stay UNVERIFIED).

## Steps

1. Open the preview URL of the branch in Safari and add it to the Home Screen. Use a QA build (`VITE_DV_QA=1`, the preview build is one) so the HUD exists.
2. In the Safari tab first: open `/?perf=1`. Wait for the HUD. Tap **Export**. Save the two files; keep `notes.json` as `notes.safari-tab.before.json`.
3. Launch the Home Screen app, open `/?perf=1`. In the Safari Web Inspector (Mac, USB) run:
   ```js
   await __dvBridge.assets.get('world_pack/p0-64-64')
   await __dvBridge.assets.get('world_pack/l0-64-64')
   ```
   Tap **Export**; keep `notes.json` as `notes.home-screen.before.json`. Its `packStore` block must show `store: "opfs"` and both fixture refs `true` in `has`.
4. Close the app from the app switcher (swipe it away). Wait 10 seconds. Launch it again from the Home Screen, open `/?perf=1`, tap **Export**; keep `notes.json` as `notes.home-screen.after.json`.
5. Merge the four files' `packStore`, `persist`, `estimate`, `standalone` and `userAgent` fields into `docs/device-spike/M01e/iphone15/notes.json` (the C15 `ManualProof.records` shape), with one line in `observations` for each of: did `has()` stay true for both packs after the relaunch, with `stats().network` 0; what `persist()` returned in the tab and in the app; the `estimate()` quota.

## Pass condition for AC-11

`has()` is true for both fixture packs after the relaunch with no network, and `notes.json` holds `open()`, `persist()` and `estimate()` for the Home Screen app and the Safari tab. If the packs are gone after the relaunch, AC-11 fails as written; record the observation in `notes.json` and report it. The store treats a missing pack as a normal miss (re-download), so the game still works, and the finding feeds U-PLT-16.
