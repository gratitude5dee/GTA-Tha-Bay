# M14b3 — launch-hardening-guardrails

## Goal
After this session the public-launch gate exists and is executable. **Split boundary (M14b, split 3 of 3):** M14b1 and M14b2 delivered the guardrails, the nightly suite, the restore drill and the rollout rule. This session turns every launch condition into machine-checkable evidence: a launch-gate record with owner, counsel, sensitivity, device and IP gates; a validator with a refusing release mode; the DoD audit H1–H10 and the trace report; `ip:history`, the Zone R `ip:similarity` adapter (DL-213) and `genai:terms-watch`; a refusing flag-flip tool; `release.yml` (`spec/08-test-and-ci.md` §5.7); and the scripted release device pass on every device of 08 §3.2.

Public launch (P0–P1; P2 publishing waits for M14a or an OpenAI grant, DL-349) follows a green gate; M14a then re-runs a subset.

## Requirements
- R-IP-01: `ip:history` over the full git history, `names:lint` on the real side and the knock-out result applied before anything is public.
- R-IP-02: likeness and counsel sign-offs are recorded gates (Q-18, Q-23); `likeness:gate` is in the release run.
- R-ENG-01: the launch gate is one command and one workflow; only human sign-offs are manual.
- R-ENG-02: device budgets are judged by `perf:verify` from uploaded reports.
- R-ENG-04: the device pass includes the accessibility rows (subtitles, reduced motion, comfort) on real devices.
- R-PLAT-05: 60 fps at `mobile` on iPhone 16/17 and 72/90 Hz on Quest are checked on device and judged by `perf:verify`.

## Depends on
M14b2, M14c, M05f2, M10c, M10d2, M10d3, M10e, M11a2, M11b4, M12e, M13c3, M06b4, M13a7, M13b2, M13b3, M08c2, M06c, M06a5, M05c3, M02d2, M02b2. These are all v1 milestones except the Thirdweb link that follows the gate. Contracts: C15 1.1 (06 v1.2 §4.2; DL-214, delivered by M00d); C13 1.1 (`PerfReport`, `DeviceChecklist`).

## Scope in
- **`docs/legal/launch-gates.json`** with schema `docs/legal/launch-gates.schema.json`. Each gate has `{ id, kind: 'signoff'|'check'|'device'|'record', status: 'pass'|'pending'|'waived'|'not-run', evidence, by?, date?, blocks: 'release'|'public-repo'|'none' }`. Required ids:
  - `Q-18` (counsel on fal ToS §4(a));
  - `Q-21:<missionId>@<irHash>` for every mission that M05c2's sensitivity rule tags;
  - `Q-23a` … `Q-23d`, and `Q-23f` (counsel confirms the `vendorTerms` flow-down clauses in `content/legal/terms.json`, M13d2);
  - `Q-13:<device>` for each §3.2 device (Desktop B/C optional, `not-run` allowed, blocks `none`);
  - `Q-15` (production domain and zone; the evidence names the public GitHub repository);
  - `nightly-3`: three consecutive green `guardrails-nightly` runs, with run URLs;
  - `restore-drill` (staging run of M14b2);
  - `csp-enforcing` (M14b2);
  - `ip-history`;
  - `ip-similarity`: blocks `public-repo` only; `not-run` until the owner creates Zone R (DL-213);
  - `names-knockout`;
  - `terms-watch`;
  - `adr-genai-01`: informational. While no provider is `cleared`, cutscenes ship as fallback-only (Q-30); it blocks `none`.
  - `dod` and `trace`;
  - `age-signals` (`record`; `research/INDEX.md` §4 rule 21; California AB 1043 applies from 2027-01-01 [research/legal-ip-likeness.md §P4]; DL-285): blocks `release` when the release run's UTC date is on or after 2027-01-01 (before that it blocks `none`), and passes only with evidence of the verified `AgeSignalProvider` built by the conditional **age-signal provider** slot below (its `spec/03` fact row and its unit test path); a counsel sign-off recorded as `Q-23e` is the explicit fallback while U-UI-1 stays unverified (DL-493); M14c's `NullAgeSignalProvider` alone never passes it;
  - `repo-renamed` (`check`, blocks `public-repo`; INDEX §4 rule 1, ADR-0007, F-067): `git remote get-url origin`, the repository name in the `Q-15` evidence and every `name` in the workspace `package.json` files contain none of the franchise tokens of `config/ip-denylist.json` (case-insensitive);
  - `odbl-offer` (`check`, blocks `release`; ADR-0021, F-053): the OSM entry of `config/attribution.world.json` carries an `offerUrl` where the derived world database and the `tools/map` bake scripts are published, and the same URL appears in the built `apps/web/dist/credits.json`, computed with M02c2's `odblOffer` (`tools/ci/odbl-offer.ts`, DL-695), which `deploy:prod` already requires for any world release;
  - `world-production` (`check`, blocks `release`; R-MAP-01, DL-695): computed by `launch-gate.ts`: `config/world/release.json` has `production: "sf"`, `assets/world/pointer.production.json` (written by `assets:publish -- --env prod --world …`; release key `production` is the `deploy:prod` run with no `--env`, M02c2 DL-661) holds `data/world-index`, and its meta file matches the current lock hashes (M02c2, DL-688); release mode also fetches `https://<Q-15 production domain>/asset-catalog.json` and resolves `data/world-index` through the manifest it names. `production: null`, a stale meta or no recorded domain leaves it `pending`, naming the reason, so v1 cannot launch on the gray-box block;
  - `license-chosen` (`check`, blocks `public-repo`; Q-08): `REUSE.toml` no longer uses `LicenseRef-DeeVerse-Owned` and `LICENSES/` holds the text of each licence it names;
  - `art-final` (`check`, blocks `release`; DL-390, DL-500): M10d2's `artFinal()` core (the `pnpm assets:final` scan over `config/art-placeholders.json`, gray-box AssetRefs and the catalog, extended by M10e with rules 4–5 for placeholder audio and unresolved `content/audio/needs.json` rows) reports `pass`; while it reports `pending` the gate is `pending` and names each finding.
  - `kill-drill` (`record`, blocks `release`; `research/INDEX.md` §4 rule 10, `05-assets-pipeline.md` §10, DL-480): computed by `launch-gate.ts` from `tests/reports/ops/kill-drill.json` (M10b's report, produced by M14b2's `quarterly.yml`). It is `pass` only when `env` is `staging`, `ranAt` is at most 92 days before the release run's UTC time and `removalMs` ≤ 60,000; a missing, stale or slow report leaves it `pending`, naming the reason.
  The three public-repo `check` gates are computed by `tools/ci/public-repo.ts`, `art-final` by `artFinal()` and `kill-drill` from the drill report, on every run; a hand-written `pass` that the computation contradicts fails completeness (DL-252).
  The record also holds `flags: [{ flag, target, requires: gateId[] }]` for `ugc.publish` (requires M13d1's recorded pass and `Q-23a`; the flip has no public effect until a `linked` provider flag, `auth.openaiWeb` or `auth.thirdweb`, is on, DL-349), `mods.enabled`, `mods.script` (M13a4 device record), `mods.ui` (M13a5 device record), `mp.enabled`, `forum.enabled`, `npc.builder`, and `auth.thirdweb` (target false until M14a).
- **`tools/ci/public-repo.ts`**: pure checks `repoRenamed({remoteUrl, repoName, packageNames, tokens})` and `licenseChosen({reuseToml, licenseFiles})`, plus `odblOffer({attribution, credits})` imported from M02c2's `tools/ci/odbl-offer.ts` (DL-695), each returning `{status, evidence}`; reads the franchise tokens from `config/ip-denylist.json` so no token is written in code. `offerUrl` on the OSM row of `config/world/sources.json` is set by M02c2's world release (AC-14, DL-695), which uploads the bake scripts and the derived database offer; this milestone only reads it.
- **`tools/ci/launch-gate.ts`**.
  - **Completeness mode** (every PR, under `check:unit -- tools/ci`): schema-valid; required ids present; every `pass` has evidence and a date; Q-21 entries match current mission IR hashes.
  - **Release mode** (`DV_RELEASE_GATE=1`, used by `release.yml`): fails, naming each gate, while any gate with `blocks: 'release'` is not `pass` or `waived`. A `waived` gate needs `by` (owner) and a reason.
- **DoD audit** (`tools/ci/test/dod.test.ts`) writes `tests/reports/dod.json` with H1–H10 per `13-qa-critics.md` §2 repo mode. It reuses M00d's `spec-files.ts` (with `strict: true` in release mode), milestone lint and `trace.ts`, and parses the critic log and recap line in `spec/00-plan.md`.
  - The trace report must have zero empty rows. In release mode `trace.ts` runs with `closure: 'M14b3'` (`'M14a'` when `DV_RELEASE_CLOSURE=M14a`, M14a's re-run; DL-450), and every row must be `tested`, `seen-on-device`, `blocked (Q-NN)` or `post-gate`; citing milestones after the closure show as `(post-gate)` and do not block. These statuses and the `empty`/`device-only` flags are consumed unchanged from M00d's `trace.ts` (`13-qa-trace.md` §1; owner gates from `spec/trace-gates.json` against this milestone's `launch-gates.json`); this milestone adds no status logic.
- **`ip:history`** (`tools/ci/ip-scan.ts --history`): the M00b rules over every blob reachable from any ref (`git rev-list --all --objects`); reports commit and path; non-zero on any hit.
- **`ip:similarity`** (`tools/ci/ip-similarity.ts`).
  - Outside the Zone R runner it prints `SKIP ip:similarity: runs only in Zone R (DL-213)` and exits 0.
  - With `--report <json>` it converts the Zone R tool's output into the gate entry: any clone of ≥ 50 tokens fails with file and line only (`13-qa.md` §3.11).
  - The owner picks the clone tool in Zone R (U-QA-5); the Builder never sees the example repositories.
  - Allowlisted vendored ports (DL-508, ADR-REUSE-01): when `third_party/` exists, a clone is reported as `expected` and does not fail the entry only when its file carries a "Portions from `third_party/<name>/<path>`" header that resolves to a `REUSE-WITH-ATTRIBUTION` entry of `docs/legal/third-party-reuse.json` with that path in `allowedPaths` at its `pinnedSha`, **and** the Zone R report's matched upstream (repository and path) equals that entry's repository and `<path>`; a report without the matched upstream counts as a mismatch. Every other clone fails as before, even in a file with a valid header (DL-523). Fixture cases in `ip-similarity.test.ts`: one resolving header with a matching upstream (expected), one header naming a path outside `allowedPaths` (fails), and one file with a valid Atlas header plus a clone whose matched upstream is an `EXCLUDED` repository, read from the register at runtime with no repository-name literal in the test source (fails).
- **`genai:terms-watch`** (`tools/ci/terms-watch.ts`): fetches each URL in the M00b vendor-terms snapshot index, normalises the text (tags and whitespace stripped) and compares SHA-256 with the snapshot. A change writes `test-results/terms-watch.json` and exits 1; `--apply` flips that provider `cleared → pending` in `config/genai-endpoints.json` for the follow-up PR. It is added to `weekly.yml` (created if absent; 08 §5.6).
- **Names knock-out** (DN-S06-02, Q-23a):
  - `config/knockout-sources.json` lists the files and fields holding placeholder makes, models, rival handles and transit operators. Read `06-racing-content.md` and `02-world-living.md` for them.
  - `docs/legal/knockout.json` holds counsel's result (`{name, verdict: 'clear'|'rename', replacement?}`).
  - The gate checks that every collected name has a verdict, that no `rename` name remains anywhere in `content/**`, `packages/**` or the catalogs, and that the replacement exists.
  - Applying renames is a data commit. `names:lint` (real side in CI) stays green.
- **`tools/ops/flag-flip.ts`** (`pnpm exec tsx tools/ops/flag-flip.ts <flag> <value> --env production`): refuses unless every gate in the flag's `requires` is `pass`; writes through route 47 (operator staff JWT) and appends to `flips[]`.
- **Age-signal provider (conditional; DL-493).** Runs only when U-UI-1 (browser shape of OS age signals, AB 1043) is resolved: the API is verified and recorded as a fact row in `spec/03` with URL and date. Until then the Builder skips it and reports `age-signals` as pending on U-UI-1.
  - Implement the real provider behind M14c's `AgeSignalProvider` in `packages/ui/src/pages/age/age-signal.ts`. It feature-detects the recorded API, maps its answer to C12 1.1 `AgeBracket` (no contract change), and falls back to `NullAgeSignalProvider` when the API is absent or errors. `AgeGate` keeps M14c's override rule.
  - Its unit test `packages/ui/test/age-signal-provider.spec.ts` uses a recorded fixture of the API's answer. A device row "OS age signal read" is added to the iPhone and Mac checklists.
  - The `age-signals` gate evidence names the `spec/03` fact row and the test. With that evidence the gate is `pass`, and `Q-23e` is not needed.
  - If U-UI-1 resolves after this milestone is merged, the slot runs as its own follow-up session on branch `m14b3-age-signals` and changes nothing else. It must merge before the first release run dated on or after 2027-01-01.
- **`release.yml`** (`workflow_dispatch`, input `tag`, environment `production` read-only). A setup step first fetches the newest `kill-drill` artifact of `quarterly.yml` into `tests/reports/ops/` (none found leaves the gate `pending`). Steps, exactly:
  1. `DV_RELEASE_GATE=1 pnpm check:unit -- tools/ci`
  2. `pnpm test:ops -- --suite guardrails`
  3. `pnpm ip:history`
  4. `pnpm names:lint`
  5. `pnpm likeness:gate`
  6. `pnpm provenance:check`
  7. `pnpm perf:verify -- <file> --auto` for each `docs/device-runs/M14b3/<device>/perf.json` (M00d `--auto`)
  8. `pnpm check:smoke -- <staging url>`
  A green run is the precondition for the production tag.
- **Device pass.** `tools/ci/checklists/M14b3-{iphone15,iphone16,quest3,visionpro,mac,webcam}.json` (plus optional `desktopB`, `desktopC`). Each runs every 08 §4.1 scenario at that device's tier and adds rows for:
  - install and offline relaunch;
  - a 30-minute soak;
  - Act 1 missions 1–3;
  - one race, one fight, one tycoon week;
  - a dialogue turn with subtitles;
  - a cutscene fallback with subtitles;
  - XR enter/exit and comfort defaults;
  - pose (webcam and iPhone, where `unavailable` is a valid outcome);
  - zero CSP violations in the console.
  Results: `docs/device-runs/M14b3/<device>/{perf.json, notes.json}`; `notes.json` records observed UNVERIFIED items.

## Scope out
- Thirdweb and the post-M14a gate subset → M14a. Bay expansion → M15a.
- Human work: counsel opinions, the sensitivity read, the knock-out search, device sessions and Zone R. They are recorded here, not produced.
- Making the repository public: a separate owner step blocked by `ip-similarity`, `repo-renamed` and `license-chosen`.

## Deliverables
- `docs/legal/{launch-gates.json, launch-gates.schema.json, knockout.json}`, `config/knockout-sources.json`.
- `tools/ci/{launch-gate.ts, ip-similarity.ts, terms-watch.ts, knockout.ts, public-repo.ts}`; `tools/ci/ip-scan.ts` (`--history`); `launch-gate.ts` also computes `world-production` (DL-695).
- `tools/ci/test/{launch-gate, dod, ip-history, ip-similarity, terms-watch, knockout, public-repo}.test.ts` and M00d's `workflows.test.ts` (extended for `release.yml`, `weekly.yml`), with fixtures (temp git repos, records, snapshots).
- `tools/ops/flag-flip.ts`, `tools/ops/test/flag-flip.test.ts`.
- `tools/ci/checklists/M14b3-*.json` (6–8 files); `docs/device-runs/M14b3/README.md`.
- `.github/workflows/{release.yml, weekly.yml}`.
- Root scripts `ip:history`, `ip:similarity`, `genai:terms-watch` (08 §6).
- Conditional slot only: `packages/ui/src/pages/age/age-signal.ts` (real provider), `packages/ui/test/age-signal-provider.spec.ts` and its fixture.
- ≈ 38 files (≈ 41 with the conditional slot).

## Interfaces
- C15 as above: the gate reads milestone files through M00d's parser. C13 1.1 `PerfReport` and `DeviceChecklist` are read by `perf:verify`. C12 1.1 route 47 is used by `flag-flip.ts`.
- No contract change.

## Acceptance criteria
- AC-1 Given the committed `launch-gates.json` When the completeness check runs Then it is schema-valid with every required id, and fixtures that lack `Q-23c` or `Q-23f`, lack a Q-21 entry for a tagged mission, or hold a `pass` without evidence each fail naming the gap — proof: `pnpm check:unit -- tools/ci`
- AC-2 Given release mode When fixture records are checked Then a record with `Q-23` pending fails naming `Q-23` and step `release`; a record whose only pending gate is `age-signals` fails when the release date is 2027-01-02 and passes when it is 2026-12-31; a record whose only non-pass gate is `ip-similarity: not-run` passes release and reports `public-repo` blocked; an all-pass record passes — proof: `pnpm check:unit -- tools/ci`
- AC-3 Given the spec tree When the DoD audit runs Then `tests/reports/dod.json` has rows H1–H10 with status and evidence and the trace report has zero empty rows. A fixture tree with a 6,001-word spec file fails H1, and a fixture AC that breaks lint rule L4 fails H4; in release mode a fixture row whose only non-DONE citing milestone is an M15 id passes as `tested` with that id marked `(post-gate)` — proof: `pnpm check:unit -- tools/ci`
- AC-4 Given the repository When the history scan runs Then it exits 0. Given a temporary repository whose deleted file once held an RPF7 header When the test scans it Then the hit names that commit and path — proof: `pnpm ip:history && pnpm check:unit -- tools/ci`
- AC-5 Given placeholder names collected from `knockout-sources.json` When the knock-out check runs with a fixture verdict `rename` whose old name still appears in `content/` Then it fails naming file and field. With the committed `knockout.json` it reports every name as `clear`, `rename` applied, or `pending` (blocking release only), and `names:lint` passes — proof: `pnpm check:unit -- tools/ci && pnpm names:lint`
- AC-6 Given a fixture snapshot index When one vendor text changes (tags and whitespace ignored) Then terms-watch exits 1, names that provider and, with `--apply`, flips it to `pending`; unchanged texts exit 0 — proof: `pnpm check:unit -- tools/ci`
- AC-7 Given no Zone R environment When `ip:similarity` runs Then it prints the SKIP line and exits 0. Given a fixture Zone R report with a 60-token clone Then the gate entry fails with file and line and no source text; the same clone in a file whose "Portions from" header resolves to an allowlisted `REUSE-WITH-ATTRIBUTION` path, with the report's matched upstream equal to that repository and path, is reported `expected` and the entry passes, while a clone from any other upstream in that file still fails (DL-508, DL-523) — proof: `pnpm ip:similarity && pnpm check:unit -- tools/ci`
- AC-8 Given `flag-flip.ts` with a record where `Q-23a` is pending When `ugc.publish true` is requested Then it refuses without calling route 47; when every required gate is `pass` it calls route 47 once (mocked) and appends to `flips[]` — proof: `pnpm check:unit -- tools/ops`
- AC-9 Given `release.yml` When the workflow test parses it Then the `kill-drill` artifact fetch precedes the steps, and the steps are exactly the eight listed in Scope in, in order, under `workflow_dispatch` with input `tag` — proof: `pnpm check:unit -- tools/ci`
- AC-10 Given iPhone 15 (`mobile-low`) and iPhone 16 or 17 (`mobile`), each as a Home Screen app, When the operator runs `M14b3-iphone15.json` and `M14b3-iphone16.json` and uploads the results Then every checklist row passes, and the run records U-PLT-1, U-PLT-3, U-PLT-4, U-PLT-5, U-API-1 and U-ENG-4 (WebSocket in a dedicated worker on iOS, DL-239) — proof: manual: iPhone 15 and iPhone 16/17, run both checklists with `pnpm perf:checklist`, then `pnpm perf:verify -- docs/device-runs/M14b3/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M14b3-iphone15.json` and the same for `iphone16` with `--tier mobile`
- AC-11 Given Quest 3 (`xr-quest`) and Vision Pro (`xr-visionpro`) When the operator runs their checklists Then every row passes, and each run records U-ENG-5, U-PLT-10, U-PLT-12 and U-PLT-13 — proof: manual: Quest 3 and Vision Pro, run `M14b3-quest3.json` and `M14b3-visionpro.json`, then `pnpm perf:verify -- docs/device-runs/M14b3/quest3/perf.json --tier xr-quest --checklist tools/ci/checklists/M14b3-quest3.json` and the same for `visionpro` with `--tier xr-visionpro`
- AC-12 Given the Apple Silicon Mac (Chrome and Safari) and a desktop with a webcam When the operator runs `M14b3-mac.json` and `M14b3-webcam.json` Then every row passes — proof: manual: Mac and webcam desktop, run both checklists, then `pnpm perf:verify -- docs/device-runs/M14b3/mac/perf.json --tier desktop --checklist tools/ci/checklists/M14b3-mac.json`
- AC-13 Given fixtures for the three public-repo gates When `public-repo.ts` evaluates them Then a remote URL or package name containing a denylisted franchise token fails `repo-renamed` naming the source, an attribution without `offerUrl` or a `credits.json` without that URL leaves `odbl-offer` `pending`, and a `REUSE.toml` still naming `LicenseRef-DeeVerse-Owned` leaves `license-chosen` `pending`; clean fixtures pass all three, and in release mode a pending `odbl-offer` fails naming step `release` while pending `repo-renamed` or `license-chosen` report `public-repo` blocked — proof: `pnpm check:unit -- tools/ci`
- AC-14 Given the branch When unit tests and the preview deploy run Then both pass and the app is unchanged — proof: `pnpm check:unit && pnpm deploy:preview`
- AC-15 Given a fixture tree whose prefab still references `vehicle/graybox.sedan` When the launch gate runs in release mode Then `art-final` is `pending`, release fails naming `art-final`, the file and the ref; given the committed repository after M10d2 (which runs after M10d1, M10d4 and M10d3, DL-460, DL-739) and M10e (DL-500), `art-final` is `pass` — proof: `pnpm check:unit -- tools/ci && pnpm assets:final`
- AC-16 Given release mode and fixture drill reports When the launch gate runs with a fixed release time Then a report whose `ranAt` is 93 days earlier fails naming `kill-drill` and `stale`, a report with `removalMs` 61,000 fails naming `kill-drill` and the time, a missing report fails naming `kill-drill`, and a staging report 30 days old with `removalMs` 42,000 passes — proof: `pnpm check:unit -- tools/ci`
- AC-17 Given release mode with a release date of 2027-01-02 When the `age-signals` gate is checked Then fixture evidence naming only `NullAgeSignalProvider` fails naming `age-signals`; evidence naming a `spec/03` fact row and an existing provider test passes; a `waived` entry without a `Q-23e` sign-off fails — proof: `pnpm check:unit -- tools/ci`
- AC-18 Given release mode and fixture `release.json`, production pointers and a mocked fetch When the launch gate runs Then `production: null` fails naming `world-production`, a production pointer without `data/world-index` or a meta whose lock hash differs from the fixture lock fails naming the reason, a fetched catalog whose manifest lacks `data/world-index` fails, and `production: "sf"` with a matching pointer, meta and catalog passes (R-MAP-01, DL-695) — proof: `pnpm check:unit -- tools/ci`

## Test plan
- Unit (`tools/ci`, `tools/ops`): every gate tool with passing and failing fixtures; git fixtures in a temp dir per test. Static: `ip:history`, `names:lint`, `ip:similarity`. Device: AC-10…AC-12 via the `device-runs` job. Release: `release.yml` fails while owner gates are pending, which is expected until the owner answers.

## Demo script
1. `pnpm check:unit -- tools/ci`: open `tests/reports/dod.json`.
2. `DV_RELEASE_GATE=1 pnpm check:unit -- tools/ci`: the pending gates are listed.
3. `pnpm exec tsx tools/ops/flag-flip.ts ugc.publish true --env production`: refused, gates named.

## Effort
1 session; ≈ 38 files; risk **high** (owner and device dependencies; the code is low risk). The conditional age-signal provider slot adds ≈ 0.2 session and 3 files when it runs (DL-493).

## Risks & fallbacks
- **U-UI-1 still unverified when the release falls on or after 2027-01-01:** the conditional slot does not run, `age-signals` stays pending, and only a recorded counsel sign-off `Q-23e` lets release proceed. Never build the provider against an unrecorded API.
- **Owner gates stay pending:** a correct outcome; release mode lists them. Never `waived` without an owner entry.
- **Terms pages are noisy:** narrow normalisation to the main text block per vendor (selector recorded in the index); never auto-flip without the weekly PR review.
- **Devices missing (Q-13):** device gates stay `pending`; Desktop B/C may be `not-run` (08 §3.2).
- **`ip:history` finds a hit:** stop and report the commit; rewriting history is the owner's call.

## Notes for the Builder
- Earlier deliverables used: M10d2 (`artFinal()`, `config/art-placeholders.json`), M10e (audio rules 4–5, `content/audio/needs.json`), M00d (milestone lint, `trace.ts`, `spec-files.ts`, `workflows.test.ts`, `perf:verify --auto`), M01c (`perf:checklist`), M00b (IP gates, terms snapshots), M05c2 (sensitivity check).
- Read first: `13-qa-critics.md` §2; `13-qa.md` §3.7, §3.11, §8; `spec/08-test-and-ci.md` §3.2–§3.3, §4, §5.6–§5.7, §6; `05-assets-pipeline.md` §9; `spec/99-open-questions.md` Q-13…Q-30; DL-211, DL-213.
- Facts: F-041, F-042 (terms inputs), F-067 (franchise mark), F-053 (ODbL share-alike for the derived database), F-013 (Quest budgets). Recorded on devices, never asserted: the U-items named in AC-10…AC-11.
- Secrets: `DV_NAMES_REAL_JSON` (CI only; locally the real side SKIPs), `CLOUDFLARE_API_TOKEN`, `CI_STAFF_DEVICE_JWK` (release run). No fal, no paid account.
- Branch `m14b3-launch-hardening-guardrails`.
