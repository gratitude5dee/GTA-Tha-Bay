import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRAND } from '../../config/brand.ts';
import tokens from '../../config/ui/tokens.json' with { type: 'json' };

// The same three headers `public/_headers` sets for static assets (11-platform-pwa.md section 2),
// applied by the dev and preview servers so crossOriginIsolated works there too.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// '1' for dev, test and preview builds; production builds leave it unset and QA code is dropped.
const QA = process.env.VITE_DV_QA === '1';

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

export default defineConfig({
  plugins: [
    brandInHtml(),
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2,wasm}', 'asset-catalog.json'],
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
  },
  // /api goes to `wrangler dev` (services/edge) on :8788; `pnpm dev` starts both.
  server: { headers: ISOLATION_HEADERS, proxy: { '/api': 'http://localhost:8788' } },
  preview: { headers: ISOLATION_HEADERS },
  build: { outDir: 'dist', emptyOutDir: true },
});
