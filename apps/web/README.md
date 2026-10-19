# @dv/web

The PWA shell: the Vite entry (`index.html`, `src/`), the service worker (`src/sw*`, built with `tsconfig.sw.json`), `public/_headers` (COOP/COEP/CORP for static assets), the web manifest and icons (`pwa-assets.config.ts`), the QA pages under `qa/` (QA builds only) and the route table that mounts the UI from `@dv/ui` and the engine from `@dv/engine`.

## Import rules

- Imports packages (`@dv/engine`, `@dv/ui`, `@dv/shared`); packages never import this app.
- QA URL flags and `window.__dvBridge` exist only when `VITE_DV_QA=1`; a production build contains neither (`pnpm check:bundle -- --forbid-qa`).
- Browser storage names start with `dv-`.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev:web` | Vite dev server with QA flags on (`pnpm dev` also starts `wrangler dev`) |
| `pnpm build` | UI tokens, then the Vite build into `dist/`, then the icon check |
| `pnpm --filter @dv/web verify:dist` | asserts the production `dist/` (no QA page, no bot input, precache content) |
| `pnpm check:unit -- apps/web` | unit tests, including the precache test that reads `dist/sw.js` |
| `pnpm check:e2e -- --project=chromium-webgl2` | Playwright against the built app and the local Worker |
