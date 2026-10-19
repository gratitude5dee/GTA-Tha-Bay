# @dv/web

The PWA shell: the Vite entry (`index.html`, `src/`), the service worker (`src/sw*`, built with `tsconfig.sw.json`), `public/_headers` (COOP/COEP/CORP for static assets), the web manifest and icons (`pwa-assets.config.ts`), the QA pages under `qa/` (QA builds only) and the route table that mounts the UI from `@dv/ui` and the engine from `@dv/engine`.

## The `/account/` island

`account/index.html` with `src/account/` is a second Vite entry: the password-account page (M00e). It is the only document that is not cross-origin isolated, mounts no canvas and loads no engine code, keeps the access token in memory (the refresh token is the HttpOnly cookie `dv-rt`) and is left out of the precache and the service worker's navigation fallback. `/account` is redirected to `/account/` by the Worker; every link in or out of the island is a full navigation.

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
