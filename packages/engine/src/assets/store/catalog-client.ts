import type { QualityTierId } from '@dv/shared';
import { resolveVariant, type AssetCatalog, type AssetKind, type AssetManifest, type AssetRef, type CatalogPointer } from '@dv/shared/assets';
import { backoffMs, MAX_ATTEMPTS } from './fetch-retry.ts';
import { sha256Hex } from './store.ts';
import type { AssetSource, PackRef } from './types.ts';

/**
 * The catalog client (M01e; 05-assets.md section 4). Reads `GET /api/v1/boot` for `hosts.media` and the catalog pointer,
 * fetches `manifests/assets-<sha256>.json`, verifies it against the pointer, and resolves `AssetRef` to tier variants.
 *
 * `catalogState`:
 * - `idle`        not loaded yet (the catalog loads on first use);
 * - `loading`     a load is running;
 * - `ready`       the catalog matches its pointer;
 * - `invalid`     the catalog failed verification: the game runs without packs and nothing is cached;
 * - `disabled`    no media base is configured (production builds before `media.<domain>` exists);
 * - `unavailable` the pointer or catalog could not be fetched (`failure` says where and why).
 */
export type CatalogState = 'idle' | 'loading' | 'ready' | 'invalid' | 'disabled' | 'unavailable';

/**
 * Why the catalog is `unavailable`: the request that failed, the HTTP status the server answered (null for a network error) and whether
 * the browser reported itself offline at that moment. A status means the media host answered and does not serve the object (a deploy
 * whose catalog was never published: `pnpm assets:publish`, M01d); `offline` is the offline relaunch path (M11a2).
 */
export interface CatalogFailure {
  stage: 'pointer' | 'catalog';
  url: string;
  status: number | null;
  offline: boolean;
}

/**
 * The retry policy of the pointer and catalog requests: the shared fetch layer's (M01e, 11-platform-pwa.md section 5), that is up to
 * `MAX_ATTEMPTS` attempts on 5xx, 429 or a network error with `backoffMs` between them, and no retry on any other 4xx. A network error
 * while `online()` is false fails at once, so an offline relaunch is not held back by the backoff (BD-FU-A01). Without this option a
 * request is tried once.
 */
export interface CatalogRetry {
  sleep: (ms: number) => Promise<void>;
  /** Uniform in [0, 1); the delay multiplier is `0.5 + random()`. */
  random?: () => number;
  /** `navigator.onLine` of the worker; absent counts as online. */
  online?: () => boolean;
}

export type CatalogFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CatalogClientOptions {
  fetch: CatalogFetch;
  /** The page origin, for same-origin URLs. */
  origin: string;
  /**
   * Path of the same-origin media mirror (QA builds pass `/media-local`; production builds pass null and so carry no trace of
   * it). A present mirror is preferred over `hosts.media`.
   */
  localMedia: string | null;
  hash?: (bytes: Uint8Array) => Promise<string>;
  retry?: CatalogRetry;
}

class CatalogFetchError extends Error {
  readonly status: number | null;
  constructor(url: string, status: number | null) {
    super(`${url}: ${status ?? 'network error'}`);
    this.status = status;
  }
}

export class AssetNotFound extends Error {
  readonly ref: string;
  constructor(ref: string, why: string) {
    super(`${ref}: ${why}`);
    this.name = 'AssetNotFound';
    this.ref = ref;
  }
}

const KIND_OF: Partial<Record<AssetKind, PackRef['kind']>> = {
  world_pack: 'chunk',
  texture: 'tex',
  ui: 'tex',
  portrait: 'tex',
  mouth_atlas: 'tex',
  character_sheet: 'tex',
  character: 'mesh',
  rig: 'mesh',
  anim: 'mesh',
  vehicle: 'mesh',
  prop: 'mesh',
  building: 'mesh',
  terrain: 'mesh',
  audio_music: 'audio',
  audio_sfx: 'audio',
  audio_bark: 'audio',
  voice: 'audio',
};

export function packKindOf(kind: AssetKind): PackRef['kind'] {
  return KIND_OF[kind] ?? 'data';
}

function isPointer(v: unknown): v is CatalogPointer {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return p['schema'] === 'asset-catalog-pointer/1' && typeof p['sha256'] === 'string' && typeof p['key'] === 'string' && typeof p['bytes'] === 'number';
}

function isCatalog(v: unknown): v is AssetCatalog {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return c['schema'] === 'asset-catalog/1' && typeof c['entries'] === 'object' && c['entries'] !== null;
}

export class CatalogClient {
  private stateValue: CatalogState = 'idle';
  private failureValue: CatalogFailure | null = null;
  private catalog: AssetCatalog | null = null;
  private mediaBaseValue: string | null = null;
  private loading: Promise<CatalogState> | null = null;
  private readonly sources: AssetSource[] = [];
  private readonly o: CatalogClientOptions;
  private readonly hash: (bytes: Uint8Array) => Promise<string>;

  constructor(o: CatalogClientOptions) {
    this.o = o;
    this.hash = o.hash ?? sha256Hex;
  }

  get state(): CatalogState {
    return this.stateValue;
  }

  /** Why the catalog is `unavailable`; null in every other state. */
  get failure(): CatalogFailure | null {
    return this.failureValue;
  }

  get mediaBase(): string | null {
    return this.mediaBaseValue;
  }

  get buildId(): string | null {
    return this.catalog?.buildId ?? null;
  }

  /** `AssetSource` hooks are consulted before the catalog. None is registered in v1; M13a2 adds the mod source. */
  registerSource(s: AssetSource): void {
    this.sources.push(s);
  }

  sourceFor(ref: AssetRef): AssetSource | null {
    return this.sources.find((s) => s.matches(ref)) ?? null;
  }

  /** Loads once; later calls return the same result. */
  load(): Promise<CatalogState> {
    if (this.stateValue !== 'idle' && this.stateValue !== 'loading') return Promise.resolve(this.stateValue);
    if (!this.loading) {
      this.stateValue = 'loading';
      this.loading = this.doLoad().then((s) => {
        this.stateValue = s;
        return s;
      });
    }
    return this.loading;
  }

  /** Forgets the loaded catalog so that the next `load()` starts again (the bridge and tests). */
  reset(): void {
    this.stateValue = 'idle';
    this.catalog = null;
    this.failureValue = null;
    this.mediaBaseValue = null;
    this.loading = null;
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.o.fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json() as Promise<unknown>;
  }

  /** One request under the retry policy (`CatalogRetry`). Resolves with an ok response; an error body is cancelled, never read. */
  private async fetchPolicy(url: string, init: RequestInit): Promise<Response> {
    const r = this.o.retry;
    const attempts = r ? MAX_ATTEMPTS : 1;
    let status: number | null = null;
    for (let n = 0; n < attempts; n++) {
      try {
        const res = await this.o.fetch(url, init);
        if (res.ok) return res;
        void res.body?.cancel().catch(() => undefined);
        status = res.status;
        if (res.status < 500 && res.status !== 429) break;
      } catch {
        status = null;
        if (r?.online && !r.online()) break;
      }
      if (r && n < attempts - 1) await r.sleep(backoffMs(n, 0.5 + (r.random ?? Math.random)()));
    }
    throw new CatalogFetchError(url, status);
  }

  private fail(stage: CatalogFailure['stage'], url: string, e: unknown): 'unavailable' {
    const status = e instanceof CatalogFetchError ? e.status : null;
    this.failureValue = { stage, url, status, offline: this.o.retry?.online ? !this.o.retry.online() : false };
    return 'unavailable';
  }

  private async hostsMedia(): Promise<string> {
    try {
      const boot = (await this.getJson(`${this.o.origin}/api/v1/boot`)) as { hosts?: { media?: unknown } } | null;
      const m = boot?.hosts?.media;
      return typeof m === 'string' ? m.replace(/\/$/, '') : '';
    } catch {
      return '';
    }
  }

  /**
   * The media base and the pointer URL. A QA build prefers the same-origin mirror (`localMedia`) when it is present (the `hosts.media`
   * values are placeholders until Q-15); otherwise `hosts.media` when non-empty; otherwise null.
   */
  private async locate(): Promise<{ base: string; pointer: string } | null> {
    if (this.o.localMedia !== null) {
      const local = `${this.o.origin}${this.o.localMedia}`;
      try {
        const res = await this.o.fetch(`${local}/asset-catalog.json`, { cache: 'no-store' });
        const body = res.ok ? ((await res.json()) as unknown) : null;
        if (isPointer(body)) return { base: local, pointer: `${local}/asset-catalog.json` };
      } catch {
        // No mirror in this build: fall through to hosts.media.
      }
    }
    const media = await this.hostsMedia();
    return media ? { base: media, pointer: `${this.o.origin}/asset-catalog.json` } : null;
  }

  private async doLoad(): Promise<CatalogState> {
    const where = await this.locate();
    if (!where) return 'disabled';
    this.mediaBaseValue = where.base;
    let pointer: unknown;
    try {
      pointer = await (await this.fetchPolicy(where.pointer, { cache: 'no-store' })).json();
    } catch (e) {
      return this.fail('pointer', where.pointer, e);
    }
    if (!isPointer(pointer)) return 'invalid';
    const url = `${where.base}/${pointer.key}`;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await (await this.fetchPolicy(url, { cache: 'no-store', mode: 'cors' })).arrayBuffer());
    } catch (e) {
      return this.fail('catalog', url, e);
    }
    if (bytes.byteLength !== pointer.bytes || (await this.hash(bytes)) !== pointer.sha256) return 'invalid';
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return 'invalid';
    }
    if (!isCatalog(parsed)) return 'invalid';
    this.catalog = parsed;
    return 'ready';
  }

  manifestOf(ref: AssetRef): AssetManifest {
    const m = this.catalog?.entries[ref];
    if (!m) throw new AssetNotFound(ref, this.catalog ? 'not in the catalog' : `no catalog (${this.stateValue})`);
    if (m.status !== 'active') throw new AssetNotFound(ref, m.status);
    return m;
  }

  /** `PackRef` for `ref` at `tier` (C07 `resolveVariant`). */
  resolve(ref: AssetRef, tier: QualityTierId): PackRef {
    const m = this.manifestOf(ref);
    const v = resolveVariant(m, tier);
    const base = this.mediaBaseValue;
    if (base === null) throw new AssetNotFound(ref, 'no media base');
    return { url: `${base}/${v.key}`, sha256: v.sha256, bytes: v.bytes, kind: packKindOf(m.kind), tags: [...m.tags] };
  }

  /** `PackRef` of every active entry whose ref starts with `prefix` (for example `world_pack/p0-`), by ref, for `tier` (M02b1). */
  refsWithPrefix(prefix: string, tier: QualityTierId): Record<string, PackRef> {
    const out: Record<string, PackRef> = {};
    for (const ref of Object.keys(this.catalog?.entries ?? {}).sort() as AssetRef[]) {
      if (!ref.startsWith(prefix)) continue;
      try {
        out[ref] = this.resolve(ref, tier);
      } catch {
        // Quarantined, killed or without a variant for this tier.
      }
    }
    return out;
  }

  /** Every variant hash of every entry: the "current" set for `gc`. */
  allHashes(): Set<string> {
    const out = new Set<string>();
    for (const m of Object.values(this.catalog?.entries ?? {})) for (const v of Object.values(m.variants)) if (v) out.add(v.sha256);
    return out;
  }

  /** Every active entry's `PackRef` for `tier`, for `downloadAll`. Entries without a variant for the tier are skipped. */
  resolveAll(tier: QualityTierId): PackRef[] {
    const out: PackRef[] = [];
    for (const ref of Object.keys(this.catalog?.entries ?? {}) as AssetRef[]) {
      try {
        out.push(this.resolve(ref, tier));
      } catch {
        // Quarantined, killed or without a variant for this tier.
      }
    }
    return out;
  }
}
