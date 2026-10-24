/**
 * Stage plates (M05c2; 03-story-cutscenes.md section D5). A plate is the first shot of a ref's DirectorScript rendered once from our own
 * SF bake at 1920 x 1080, with the actors hidden; its SHA-256 goes into `content/cutscenes/plates.lock.json` and from there into the
 * `inputHashes` of the ref's cutscene key. This module is the part of the tool that needs no browser: which shot to render, how the lock
 * is merged, the provenance record of an upload. The browser side is `PlateRenderer`: the real one drives headless Chromium with
 * `?beats=plate` and needs a page that offers the QA plate bridge (`window.__dvBridge.plate`); without one it answers with a reason and
 * the CLI skips (the plates are then rendered where such a build and a WebGPU adapter exist, and only the lock is committed).
 */
import { createHash } from 'node:crypto';
import type { CutsceneRef, DirectorScript } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { buildRecord } from '../provenance-new.ts';

export const PLATE_W = 1920;
export const PLATE_H = 1080;
export const PLATES_LOCK_SCHEMA = 'cutscene-plates/1';

export interface PlateJob {
  ref: string;
  /** The stage id without the `@rev` (the key of the lock). */
  stage: string;
  /** The DirectorScript whose first shot is rendered. */
  director: string;
  /** The mark the first shot looks from (the shot's `from`, else its subject's start mark). */
  mark: string;
  at: DirectorScript['marks'][string]['at'];
  yawDeg: number;
  lens: 'wide' | 'normal' | 'tele';
}

export interface PlateLock {
  schema: typeof PLATES_LOCK_SCHEMA;
  note: string;
  plates: Record<string, { sha256: string; ref?: string }>;
}

export const stageBase = (stage: string | null): string => (stage ?? '').replace(/@\d+$/, '');
export const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function emptyPlateLock(): PlateLock {
  return {
    schema: PLATES_LOCK_SCHEMA,
    note: 'Stage plates by stage id (without @rev): the SHA-256 of the 1920x1080 PNG pnpm assets:plates rendered from the SF bake. The cutscene index reads the hashes from here and never re-renders; --refresh is a deliberate re-pin.',
    plates: {},
  };
}

/** The shots to render: one per ref that has a stage and a DirectorScript fallback with a first shot. Problems name what blocks a ref. */
export function plateJobs(refs: readonly CutsceneRef[], directors: ReadonlyMap<string, DirectorScript>, pick: (ref: CutsceneRef) => boolean): { jobs: PlateJob[]; problems: string[] } {
  const jobs: PlateJob[] = [];
  const problems: string[] = [];
  for (const ref of refs) {
    if (!pick(ref)) continue;
    if (!ref.stage) {
      problems.push(`${ref.id}: has no stage`);
      continue;
    }
    const d = directors.get(ref.fallback);
    if (!d) {
      problems.push(`${ref.id}: the DirectorScript ${ref.fallback} is not in assets/src/data`);
      continue;
    }
    const first = [...d.shots].sort((a, b) => a.atSec - b.atSec)[0];
    const markName = first?.from ?? Object.keys(d.marks)[0];
    const mark = markName ? d.marks[markName] : undefined;
    if (!first || !markName || !mark) {
      problems.push(`${ref.id}: ${ref.fallback} has no first shot with a mark`);
      continue;
    }
    jobs.push({ ref: ref.id, stage: stageBase(ref.stage), director: d.id, mark: markName, at: mark.at, yawDeg: mark.yawDeg, lens: first.lens });
  }
  return { jobs, problems };
}

/** The lock with the new hashes; entries not rendered now stay. A changed hash of an existing stage is only taken with `refresh`. */
export function mergeLock(prev: PlateLock, rendered: readonly { stage: string; sha256: string; ref?: string }[], refresh: boolean): { lock: PlateLock; kept: string[]; problems: string[] } {
  const lock: PlateLock = { ...prev, plates: { ...prev.plates } };
  const kept: string[] = [];
  const problems: string[] = [];
  for (const r of rendered) {
    const had = lock.plates[r.stage];
    if (had && had.sha256 !== r.sha256 && !refresh) {
      kept.push(r.stage);
      problems.push(`${r.stage}: a plate is pinned (${had.sha256.slice(0, 12)}); pass --refresh to re-pin it`);
      continue;
    }
    lock.plates[r.stage] = { sha256: r.sha256, ...(r.ref ? { ref: r.ref } : {}) };
  }
  lock.plates = Object.fromEntries(Object.entries(lock.plates).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { lock, kept, problems };
}

/** The private object key of a plate. */
export const plateObjectKey = (sha256: string): string => `plates/${sha256}.png`;

/** The provenance record of an uploaded plate: origin `derived` from the world pack bytes it was rendered from (C07 1.1, DL-161). */
export function plateRecord(sha256: string, derivedFrom: readonly string[], argsSha256: string, createdAt: string) {
  return buildRecord({
    sha256,
    paths: [plateObjectKey(sha256)],
    kind: 'image',
    origin: 'derived',
    license: 'LicenseRef-DeeVerse-Owned',
    authors: ['studio:dee-verse'],
    derivedFrom: [...derivedFrom],
    tool: { name: 'assets:plates', version: '1', args_sha256: argsSha256 },
    createdAt,
  });
}

/** What the browser side hands back for one shot. */
export interface RenderedPlate {
  png: Uint8Array;
  /** SHA-256 of the `world_pack` files the page had resident for the shot. */
  worldPacks: string[];
}

export interface PlateRenderer {
  render(job: PlateJob): Promise<RenderedPlate>;
  close(): Promise<void>;
}

/** Either a renderer, or why there is none here. */
export type RendererResult = { ok: true; renderer: PlateRenderer } | { ok: false; reason: string };

/**
 * Headless Chromium on the game page. The page must announce `window.__dvBridge.plate.render(job)` (QA builds with `?beats=plate`); a page
 * without it, a browser without a WebGPU adapter or a missing Playwright browser all give `{ ok: false, reason }` so the CLI can skip.
 */
export async function chromiumRenderer(o: { baseUrl: string; webgpu: boolean }): Promise<RendererResult> {
  let pw: typeof import('@playwright/test');
  try {
    pw = await import('@playwright/test');
  } catch (e) {
    return { ok: false, reason: `Playwright is not available (${(e as Error).message})` };
  }
  let browser;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: o.webgpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader'],
    });
  } catch (e) {
    return { ok: false, reason: `Chromium did not start (${(e as Error).message.split('\n')[0]})` };
  }
  const page = await browser.newPage({ viewport: { width: PLATE_W, height: PLATE_H } });
  try {
    await page.goto(`${o.baseUrl.replace(/\/+$/, '')}/?play=off&debug=1&beats=plate${o.webgpu ? '' : '&gl=1'}`, { timeout: 60_000 });
    const has = await page.evaluate(() => typeof (window as unknown as { __dvBridge?: { plate?: { render?: unknown } } }).__dvBridge?.plate?.render === 'function').catch(() => false);
    if (!has) {
      await browser.close();
      return { ok: false, reason: 'the page offers no QA plate bridge (window.__dvBridge.plate): build the app with VITE_DV_QA=1 and the plate scene (not part of this build)' };
    }
  } catch (e) {
    await browser.close();
    return { ok: false, reason: `the game page did not load at ${o.baseUrl} (${(e as Error).message.split('\n')[0]})` };
  }
  return {
    ok: true,
    renderer: {
      async render(job) {
        const res = (await page.evaluate((j) => (window as unknown as { __dvBridge: { plate: { render(job: unknown): Promise<{ worldPacks: string[] }> } } }).__dvBridge.plate.render(j), job)) as { worldPacks: string[] };
        const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: PLATE_W, height: PLATE_H } });
        return { png: new Uint8Array(png), worldPacks: res.worldPacks };
      },
      close: () => browser.close(),
    },
  };
}
