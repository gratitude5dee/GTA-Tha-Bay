# @dv/ui

The Preact shell for DOM UI: the shell state machine and page registry (`src/shell`), the UI kit (`src/kit`), the `ScreenDef` renderers (`src/screen`), pages (`src/pages`), i18n (`src/i18n`) and the design tokens built by `scripts/build-tokens.ts`. Preact is for DOM UI only; rendering is vanilla three in `@dv/engine`.

## Layout

- `src/shell`: `ShellCore` (state machine of 10-ui.md section 2.4, the page frame, modals, toasts, the QA play bypass), `ShellApp` (the Preact view), `registry.ts` (page table and gates), `gates.ts`, `prefs.ts` (`UiPrefs` in IndexedDB `dv-ui`), `binder.ts` (settings by scope), `banners.tsx`.
- `src/kit`: focus navigation (`focus.ts`: arrows, pad, Escape/Backspace), widgets, toasts, dialogs, the on-screen keyboard.
- `src/screen`: `ScreenDef` types and its two renderers, `DomScreen` and `CanvasScreen`, which list the same focusables in the same order.
- `src/pages`: Title, age, blocked and Terms (`gate.tsx`), the main menu, Continue/Load, profile, saves and New Game, the mode tiles, Settings (`settings/`), and the system pages. Each is a lazy chunk.
- The shell talks to the engine only through the ports in `src/shell/types.ts` (`EnginePort`, `SavesPort`, `PlatformPort`, `ShellHooks`); `apps/web/src/shell-ports.ts` implements them.

## Import rules

- Imports `@dv/shared` (and, from later milestones, `@dv/engine` services through their interfaces); never imports `apps/*`.
- Every user-visible string comes from the i18n catalogue `content/ui/i18n/en.json`; the display name comes only from `config/brand.ts` (`DISPLAY_NAME`) through the `{brand}` placeholder.
- Browser storage names start with `dv-` (`dv-ui` for preferences).

## Scripts

| Command | Does |
|---|---|
| `pnpm --filter @dv/ui run tokens` | builds the design tokens (also run by `pnpm build`) |
| `pnpm check:unit -- packages/ui` | unit tests for the shell, kit, screens and pages |
| `pnpm check:i18n` | missing and unused English keys, stale translations, display-name literals |
| `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-menus` | the menu flows (also `@ui-age`, `@ui-saves`, `@ui-a11y`) |

## QA play bypass

QA builds only (`VITE_DV_QA=1`): `?play=sandbox`, `?play=story`, the `localStorage` key `dv-qa-play`, or `?scenario=<id>` skips the age screen, the Terms and the menus and starts that mode on an in-memory profile; `?play=off` shows the normal flow. The Playwright configs set the key, so the engine specs load straight into play.
