## What and why

<!-- One or two sentences. Link the milestone or issue. -->

## Checks

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm check:unit` pass locally
- [ ] Milestone acceptance criteria run, with the proof commands quoted below

## Clean-room statement

Tick exactly one of the two boxes (DL-632).

- [ ] No upstream example repository (`research/repos-*.md`) was opened, fetched or searched for this change; no code, data, names, constants or layouts were consulted or copied from any such repository, or copied from any other repository other than declared package dependencies and open-data sources under their own licence rules, except files under `third_party/` listed `REUSE-WITH-ATTRIBUTION` in `docs/legal/third-party-reuse.json`.
- [ ] Vendoring PR: each upstream was fetched at its `pinnedSha` outside any Builder session, only `allowedPaths` and `licenceFiles` files were copied, every data subset was written by `pnpm reuse:subset`, and `ip:*`, `license:scan`, `names:lint` and `provenance:check` were run. (Operator or Architect only.)

## Provenance and likeness

- [ ] Every new shipped file has a record under `assets/provenance/` (`pnpm provenance:new`)
- [ ] No real person's name, alias or voice appears in client code, content or records (real people go through the name registry and likeness tiers)
- [ ] Any new generative-AI endpoint is in `config/genai-endpoints.json` with its price and terms snapshot

## Notes for the reviewer

<!-- Anything the gates cannot show: UNVERIFIED items, operator actions, contract change proposals. -->
