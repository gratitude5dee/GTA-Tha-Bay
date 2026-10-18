# Proposal (not an ADR): C03 `Binder.attach` parameter type

Status: proposed by the M01a1 Builder, 2026-10-18. For the Architect to accept, amend or reject. No contract text was edited.

## Problem

C03 1.1 declares `attach(target: EventTarget | XRSession): void` in `packages/shared/src/contracts/c03-input.ts`. `@dv/shared` is compiled by the sim tsconfig (`packages/engine/tsconfig.sim.json`, `lib: ["ES2023"]`, `types: []`), which has neither the DOM lib (`EventTarget`) nor the WebXR types (`XRSession`). The verbatim line therefore does not compile there, and C02 determinism rule 1 forbids DOM types in sim-reachable code.

## What the Builder did

The file declares a structural stand-in and uses it for the parameter:

```ts
export interface BinderTarget {
  addEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
}
attach(target: BinderTarget): void;
```

`EventTarget`, `Window`, `HTMLElement` and `XRSession` (which extends `EventTarget`) are all assignable to `BinderTarget`, so every call site that compiled against the 1.1 text still compiles. Nothing else in C01, C02 or C03 differs from `spec/domains/01-engine-contracts.md`, apart from two mechanical changes:

- `c02-loop.ts` uses top-level `import type` instead of `import('...')` type expressions (ESLint `consistent-type-imports`), and re-exports `QualityTierId` from C13 so `export *` from the package root has one symbol.
- the C03 1.1 additions (`'bot'` device, `'xr:both:wheel'`, `setPoseHybrid`, `fighterScheme`, `BotInput`) are merged into the 1.0 declarations instead of repeated as deltas.

## Request

Accept `BinderTarget` as the C03 text (C03 1.1.1, a type-only clarification), or name another DOM-free type. M01b1 implements the binders against whichever is chosen.
