# @dv/mode-fighter

The Culture Wars fighter. **M08a1** (this package today) holds the tools around the pure fight core; the mode itself (descriptor, ECS mirror, camera, HUD, Training, CPU, device schemes, stage) is M08a2.

## Where things live

| Path | Holds |
|---|---|
| `packages/shared/src/fight/` | the core (`@dv/shared/fight`): frame-data types, `Int32Array` buffer, input map, parser, states, hits, meters, rounds, projectiles, hash, replay. Sim code under the C02 lint; integers only, no allocation inside `step` |
| `config/fighter.tuning.json` | the FC2 constants table |
| `content/fighter/kits/player.json` | the reference kit `PLAYER_FIGHTER` (FX3): twelve moves, Surge, placeholders for Showstopper, Shutdown and Taunt |
| `src/lint/` | `fighter:lint` rules (schema, derived advantage, startup, recovery, box bounds, reachable hits, reachable inputs, name collisions, cancel-loop search, FX3 reference) |
| `src/qa/script-driver.ts` | `fighter.script`: the C03 `BotInput` (`device: 'bot'`) from a seeded script |
| `scripts/{lint,replay,make-goldens}.ts` | the CLIs |
| `golden/vs-001.dvfight`, `golden/vs-002.dvfight` | the golden replays (every 60-tick checkpoint hash) |
| `test/` | lint, replay and driver specs; `fixtures/kits/bad-*.json` fail one lint rule each |

## Commands

```bash
pnpm --filter @dv/mode-fighter fighter:lint                          # tuning + every kit, prints the derived frame-data table
pnpm --filter @dv/mode-fighter fighter:lint -- path/to/kit.json      # one kit
pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight golden/vs-002.dvfight
pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight --kit scratch-kit.json --force   # names the first bad checkpoint
pnpm --filter @dv/mode-fighter test                                   # also part of pnpm check:unit
pnpm check:unit -- packages/shared/test/fight                         # the core: parser, hits, scaling, meters, rounds, hash, no-alloc
```

Regenerate the goldens only after a deliberate data or rules change, with the `golden-update` label:

```bash
DV_UPDATE_GOLDEN=1 pnpm --filter @dv/mode-fighter exec tsx scripts/make-goldens.ts
DV_UPDATE_GOLDEN=1 pnpm check:unit -- packages/shared/test/fight/hash-vectors   # packages/shared/test/golden/fight/hash.v1.json
```

## Rules of the data

`onHit` and `onBlock` are derived, never authored: `advHit = hitstun - (A + R - 1)`, `advBlock = blockstun - (A + R - 1)`. A kit that carries them fails the schema. Startup counts the first active frame. Builder decisions: `spec/11-decision-log-builder.md` rows `BD-M08a1-*`.

## Status

M08a1 is complete for the runnable ACs; `pnpm deploy:preview` (AC-11) needs the Cloudflare token and was not run here. The PR needs the `golden-update` label (new goldens: `golden/*.dvfight`, `packages/shared/test/golden/fight/hash.v1.json`, and the refreshed `goldens-package` hash in `tools/ci/verifiers.lock.json`).
