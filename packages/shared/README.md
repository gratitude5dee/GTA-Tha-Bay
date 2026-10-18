# @dv/shared

Pure, deterministic code shared by the browser, Workers and CI. No IO, no clocks, no randomness source, no DOM, no `three`, and no import of any other workspace package.

## Contents (M01a1)

| Path | What |
|---|---|
| `src/contracts/` | C01 ECS, C02 loop and C03 input contract types (copied from `spec/domains/01-engine-contracts.md`; change only through the Architect) |
| `src/detmath.ts` | `dsqrt dsin dcos datan2 dexp dlog dpow dhypot lerpAngle normalizeAngle` and the frozen `detmath` object. Only `+ - * /`, exact `Math.*` and integer bit operations; ports of the fdlibm kernels |
| `src/rng.ts` | `splitmix32`, `Rng` (xoshiro128**), `streams(seed)` named streams, stateless `ctrU32` |
| `src/hash.ts` | `fnv32`, incremental two-lane `Fnv64`, `fnv64Hex`, synchronous `sha256Hex`, `utf8Bytes` |
| `src/json.ts` | `canonicalize` (sorted keys, `-0` as `0`, throws `CanonicalizeError` with the JSON path) |
| `src/platform/` | C13 platform contract types and the PWA update controller type (M00) |

## Import rules

- Sim code (this package, `packages/engine/src/sim/**`, `packages/modes/*/src/sim/**`) obeys the C02 determinism lint: no `Math.random`, no transcendental `Math.*`, no `**`, no `Date`, timers or `performance.now`, no `for...in`, no `Intl`, no `sort()` without a comparator, no `three`, no DOM globals. `config/eslint/determinism.mjs` holds the rules.
- Use `detmath` instead of `Math.sin`, `Math.sqrt`, `Math.pow` and friends. Inputs beyond |x| = 1e9 for `dsin`/`dcos` give a deterministic value in [-1, 1] without an accuracy guarantee.
- Random numbers come from `streams(seed).get(name)`; per-agent or per-event draws that must not shift when content is added use `ctrU32(seed, stream, counter)`.

## Scripts

```
pnpm --filter @dv/shared test            # vitest run: vectors, RNG, hashes, canonical JSON
pnpm --filter @dv/shared vectors:write   # regenerate test/golden/*.v1.json; refuses to overwrite without --force
```

The golden files hold IEEE-754 bit patterns (16 hex digits). A changed vector means a change in simulation behaviour: review it before passing `--force`.
