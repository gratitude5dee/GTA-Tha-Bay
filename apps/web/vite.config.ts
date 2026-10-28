import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRAND } from '../../config/brand.ts';
import { cspForBuild } from '../../config/csp-hosts.ts';
import tokens from '../../config/ui/tokens.json' with { type: 'json' };
import { cutsceneFixtures } from './vite/cutscene-fixtures.ts';
import { basisTranscoder } from './vite/basis-transcoder.ts';
import { mediaLocal } from './vite/media-local.ts';
import { moduleIds } from './vite/module-ids.ts';
import { qaPrecache } from './vite/qa-precache.ts';

// The same three headers `public/_headers` sets for static assets (11-platform-pwa.md section 2),
// applied by the dev and preview servers so crossOriginIsolated works there too. /account/* is the one exception (M00e).
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// '1' for dev, test and preview builds; production builds leave it unset and QA code is dropped.
const QA = process.env.VITE_DV_QA === '1';

// Build id for tier decisions and telemetry: VITE_DV_BUILD, the CI commit, or the local commit short sha.
function buildId(): string {
  const fromEnv = process.env.VITE_DV_BUILD ?? process.env.GITHUB_SHA?.slice(0, 12);
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// QA builds only: the chunks that only QA code loads stay out of the precache (BD-FIX-CI7-D04); a production build has none.
const qaOnly = QA ? qaPrecache(here('../..'), here('.dv-build/qa-precache.json')) : null;

// Each Rapier build is its own chunk (it embeds about 3 MB of wasm as base64). The names let the service worker
// precache the simd-compat chunk and leave the deterministic-compat chunk to load on demand (M01a2).
function chunkName(chunk: { moduleIds: string[]; name: string }): string {
  // M04b1: every shell page is its own lazy chunk (`page-<name>`), apart from the shell chunk (check:bundle reads both).
  if (chunk.moduleIds.length > 0 && chunk.moduleIds.every((id) => id.includes('/packages/ui/src/pages/'))) return 'assets/page-[name]-[hash].js';
  if (chunk.moduleIds.some((id) => id.includes('rapier3d-deterministic-compat'))) return 'assets/rapier-deterministic-[hash].js';
  if (chunk.moduleIds.some((id) => id.includes('rapier3d-simd-compat'))) return 'assets/rapier-simd-[hash].js';
  return 'assets/[name]-[hash].js';
}

function isolationHeaders(): Plugin {
  const apply = (server: { middlewares: Connect.Server }): void => {
    server.middlewares.use((req, res, next) => {
      if (!/^\/account(\/|\?|$)/.test(req.url ?? '')) for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.setHeader(k, v);
      next();
    });
  };
  return { name: 'dv-isolation-headers', configureServer: apply, configurePreviewServer: apply };
}

function brandInHtml(): Plugin {
  const values: Record<string, string> = {
    '%DISPLAY_NAME%': BRAND.displayName,
    '%SHORT_NAME%': BRAND.shortName,
    '%TAGLINE%': BRAND.tagline,
    '%THEME_COLOR%': tokens.manifest.themeColor,
  };
  return {
    name: 'dv-brand-in-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => Object.entries(values).reduce((out, [k, v]) => out.replaceAll(k, v), html),
    },
  };
}

// public/_headers carries %CSP_REPORT_ONLY%; the build writes the Report-Only policy of spec/05 section 1.3 into dist/_headers (DL-191).
function cspInHeaders(): Plugin {
  return {
    name: 'dv-csp-in-headers',
    apply: 'build',
    closeBundle() {
      const file = here('dist/_headers');
      if (!existsSync(file)) return;
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('%CSP_REPORT_ONLY%', cspForBuild()));
    },
  };
}

export default defineConfig({
  plugins: [
    isolationHeaders(),
    brandInHtml(),
    // M10d0: the Basis transcoder of the KTX2 surface textures, same-origin at /basis/.
    basisTranscoder(here('../..')),
    moduleIds(here('.'), here('../..'), true),
    ...(qaOnly ? [qaOnly.main()] : []),
    // QA builds only: the same-origin mirror of the asset store (M01e).
    ...(QA ? [mediaLocal(here('.')), cutsceneFixtures(here('.'))] : []),
    cspInHeaders(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        rollupFormat: 'iife',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // asset-catalog.json is the catalog pointer (DL-042): it must be in the precache so a new Worker version switches content.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2,wasm,pack}', 'asset-catalog.json'],
        // The deterministic-compat build loads on demand (canonical sessions only); QA pages and QA-only chunks are never precached.
        // The /account/ island is a separate, non-isolated document: it stays out of the precache and the SPA fallback (M00e).
        globIgnores: ['**/rapier-deterministic-*.js', 'qa/**', 'media-local/**', 'account/**', 'assets/account-*.js'],
        // QA builds: neither the QA pages nor the chunks only QA code loads (the bridges, panels, QA sim modes and QA-page workers).
        ...(qaOnly ? { manifestTransforms: [qaOnly.transform] } : {}),
      },
      manifest: {
        id: '/',
        name: BRAND.displayName,
        short_name: BRAND.shortName,
        description: BRAND.tagline,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: tokens.manifest.themeColor,
        background_color: tokens.manifest.backgroundColor,
        icons: [
          { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  define: {
    'import.meta.env.VITE_DV_QA': JSON.stringify(QA ? '1' : '0'),
    'import.meta.env.VITE_DV_BUILD': JSON.stringify(buildId()),
  },
  // /api goes to `wrangler dev` (services/edge) on :8788; `pnpm dev` starts both.
  server: { proxy: { '/api': 'http://localhost:8788' } },
  worker: { format: 'es', plugins: () => [moduleIds(here('.'), here('../..'), false), ...(qaOnly ? [qaOnly.worker()] : [])], rollupOptions: { output: { chunkFileNames: chunkName } } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The determinism page and the memory bomb exist only in QA builds (VITE_DV_QA=1).
      input: {
        main: here('index.html'),
        account: here('account/index.html'),
        ...(QA ? { 'qa/determinism': here('qa/determinism.html'), 'qa/memory-bomb': here('qa/memory-bomb.html'), 'qa/save-kill': here('qa/save-kill.html'), 'qa/world-hash': here('qa/world-hash.html'), 'qa/cutscene-spike': here('qa/cutscene-spike.html'), 'qa/mission-preview': here('qa/mission-preview.html') } : {}),
      },
      output: {
        chunkFileNames: chunkName,
        // The shell (state machine, registry, kit, i18n) and Preact form one named chunk, apart from the engine boot code in the entry (M04b1, AC-13).
        codeSplitting: { groups: [{ name: 'shell', test: /packages\/ui\/src\/(index\.tsx|shell|kit|i18n|screen)\/|node_modules\/\.pnpm\/preact@/ }] },
        // The island's entry gets its own name so the precache can leave it out (globIgnores above).
        entryFileNames: (chunk) => (chunk.facadeModuleId?.includes('/src/account/') ? 'assets/account-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
