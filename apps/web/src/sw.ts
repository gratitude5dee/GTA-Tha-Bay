/// <reference lib="webworker" />
/**
 * Service worker (11-platform-pwa.md section 4): precaches the app shell only. World content never goes
 * through the service worker or the Cache API (asset.worker + OPFS, M01e). Updates are prompt-style: a new
 * worker waits until the page posts SKIP_WAITING at a safe point.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, PrecacheController, PrecacheRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { SKIP_WAITING_MESSAGE } from './pwa-update.ts';
import { installPrecache } from './sw-precache.ts';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | PrecacheEntry> };

// What precacheAndRoute() sets up, except that the install fetches a few entries at a time instead of one (sw-precache.ts,
// BD-FIX-CI6-C02): the same default precache cache name, PrecacheRoute options and activate-time removal of stale entries.
const precache = new PrecacheController();
precache.addToCacheList(self.__WB_MANIFEST);
self.addEventListener('install', (event) => event.waitUntil(installPrecache(precache, event)));
self.addEventListener('activate', precache.activate);
registerRoute(new PrecacheRoute(precache));
cleanupOutdatedCaches();

// The precached index.html keeps the COOP/COEP headers it was installed with. The API and the
// non-isolated account area and the QA pages (QA builds only) are never answered from the shell.
registerRoute(
  new NavigationRoute(precache.createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/account(\/|$)/, /^\/qa\//, /^\/media\//],
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
