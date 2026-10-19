/// <reference lib="webworker" />
/**
 * Service worker (11-platform-pwa.md section 4): precaches the app shell only. World content never goes
 * through the service worker or the Cache API (asset.worker + OPFS, M01e). Updates are prompt-style: a new
 * worker waits until the page posts SKIP_WAITING at a safe point.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { SKIP_WAITING_MESSAGE } from './pwa-update.ts';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | PrecacheEntry> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The precached index.html keeps the COOP/COEP headers it was installed with. The API and the
// non-isolated account area and the QA pages (QA builds only) are never answered from the shell.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/account(\/|$)/, /^\/qa\//],
  }),
);

// Control pages on first install; later versions wait for SKIP_WAITING.
clientsClaim();

self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === SKIP_WAITING_MESSAGE) {
    void self.skipWaiting();
  }
});
