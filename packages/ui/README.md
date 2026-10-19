# @dv/ui

The Preact shell for DOM UI: the UI kit (`src/kit`), pages, HUD, i18n (`src/i18n`) and the design tokens built by `scripts/build-tokens.ts`. Preact is for DOM UI only; rendering is vanilla three in `@dv/engine`.

## Import rules

- Imports `@dv/shared` (and, from later milestones, `@dv/engine` services through their interfaces); never imports `apps/*`.
- Every user-visible string comes from the i18n catalogue; the display name comes only from `config/brand.ts` (`DISPLAY_NAME`).
- Browser storage names start with `dv-` (`dv-ui` for preferences).

## Scripts

| Command | Does |
|---|---|
| `pnpm --filter @dv/ui run tokens` | builds the design tokens (also run by `pnpm build`) |
| `pnpm check:unit -- packages/ui` | unit tests for the kit and pages |
