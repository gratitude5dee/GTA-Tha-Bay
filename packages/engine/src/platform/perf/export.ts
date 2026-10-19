import type { DeviceSignals, PerfReport, QualityTierId, RenderBackend } from '@dv/shared';
import type { AssetClient } from '../../assets/client.ts';

/**
 * Export of device runs (11-platform-perf.md section 9): `perf.json` is the `PerfReport`; `notes.json` is free-form operator
 * output with the signals, `navigator.storage.persist()`, `estimate()` and the UA string. QA builds only: notes carry the user
 * agent, which telemetry never does.
 */
export interface PerfNotes {
  v: 1;
  createdAt: number;
  userAgent: string;
  tier: QualityTierId;
  backend: RenderBackend;
  crossOriginIsolated: boolean;
  standalone: boolean;
  /** Result of `navigator.storage.persist()`, or null when unavailable. */
  persist: boolean | null;
  estimate: { quotaMB: number; usageMB: number } | null;
  /** rAF rate measured over about one second, in Hz. */
  rafHz: number | null;
  signals: DeviceSignals;
  /** Free-form lines the operator adds on the device (button indices, behaviour after the memory bomb). */
  observations: string[];
  /** Total of the last memory-bomb run, from `localStorage['dv.membomb']`. */
  memoryBombMB: number | null;
  /** The world-pack store (M01e AC-11): what `open()` returned, whether the fixture packs are present, and `usage()`. */
  packStore?: {
    store: 'opfs' | 'memory-fallback';
    mode: 'rw' | 'read-only';
    has: Record<string, boolean>;
    packs: number;
    packsMB: number;
    persisted: boolean | null;
  };
}

/** The packs the M01e device run checks before and after the relaunch. */
export const PACK_STORE_PROBE_REFS = ['world_pack/p0-64-64', 'world_pack/l0-64-64'] as const;

const MB = 1024 * 1024;

export function measureRafHz(frames = 60): Promise<number | null> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const times: number[] = [];
    const step = (t: number): void => {
      times.push(t);
      if (times.length > frames) {
        const span = (times[times.length - 1] as number) - (times[0] as number);
        resolve(span > 0 ? Math.round(((times.length - 1) * 1000) / span) : null);
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export interface NotesInput {
  now: number;
  tier: QualityTierId;
  backend: RenderBackend;
  signals: DeviceSignals;
  assets?: AssetClient | null;
}

async function packStoreNotes(assets: AssetClient): Promise<NonNullable<PerfNotes['packStore']>> {
  const has: Record<string, boolean> = {};
  for (const ref of PACK_STORE_PROBE_REFS) has[ref] = await assets.has(ref).catch(() => false);
  const u = await assets.usage().catch(() => null);
  return { store: assets.storeKind, mode: assets.mode, has, packs: u?.packs ?? 0, packsMB: u?.packsMB ?? 0, persisted: u?.persisted ?? null };
}

export async function buildNotes(input: NotesInput): Promise<PerfNotes> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  let persist: boolean | null = null;
  let estimate: PerfNotes['estimate'] = null;
  try {
    persist = storage?.persist ? await storage.persist() : null;
  } catch {
    persist = null;
  }
  try {
    const e = await storage?.estimate?.();
    if (e) estimate = { quotaMB: Math.round((e.quota ?? 0) / MB), usageMB: Math.round((e.usage ?? 0) / MB) };
  } catch {
    estimate = null;
  }
  let bomb: number | null = null;
  try {
    const raw = localStorage.getItem('dv.membomb');
    bomb = raw === null ? null : Number(raw);
    if (bomb !== null && !Number.isFinite(bomb)) bomb = null;
  } catch {
    bomb = null;
  }
  return {
    v: 1,
    createdAt: input.now,
    userAgent: navigator.userAgent,
    tier: input.tier,
    backend: input.backend,
    crossOriginIsolated: self.crossOriginIsolated,
    standalone: input.signals.displayModeStandalone,
    persist,
    estimate,
    rafHz: await measureRafHz(),
    signals: input.signals,
    observations: [],
    memoryBombMB: bomb,
    ...(input.assets ? { packStore: await packStoreNotes(input.assets) } : {}),
  };
}

/** Downloads `data` as a pretty-printed JSON file through a temporary anchor. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportReport(report: PerfReport | null, notes: PerfNotes): void {
  if (report) downloadJson('perf.json', report);
  downloadJson('notes.json', notes);
}
