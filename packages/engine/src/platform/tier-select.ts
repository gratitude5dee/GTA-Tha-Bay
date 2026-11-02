import {
  C13_VERSION,
  provisionalTier,
  stepDownTier,
  type BenchmarkResult,
  type DeviceProfile,
  type PlatformSettings,
  type QualityTier,
  type QualityTierId,
  type RenderBackend,
  type TierDecision,
} from '@dv/shared';
import type { PlatformStore } from './platform-store.ts';
import type { QaFlags } from './qa-flags.ts';
import { TIERS } from './tier-config.ts';

/**
 * Tier selection (11-platform.md section 5.3): provisional tier from the device profile, then a benchmark that steps down one
 * rung of FLAT_LADDER when p90 > frameBudgetMs x 1.1, at most twice. Promotion to `desktop-ultra` needs a non-fallback WebGPU
 * adapter and p90 <= 0.5 x 16.7 ms at `desktop` settings (DN-S11-05). The decision persists in IndexedDB
 * `dv-platform/tier-decision` and is re-used while `build`, `uaHash` and `adapterHash` match.
 */
export const MAX_STEP_DOWNS = 2;
/** The benchmark p90 limit is the tier's frame budget times this. */
export const BENCHMARK_TOLERANCE = 1.1;
/** 0.5 x 16.7 ms. */
export const ULTRA_P90_MS = 8.35;

export type RunBenchmark = (tier: QualityTier) => Promise<BenchmarkResult>;

export interface TierSelectorDeps {
  profile: DeviceProfile;
  build: string;
  qa: Pick<QaFlags, 'enabled' | 'tier'>;
  store: PlatformStore;
  settings: Pick<PlatformSettings, 'tierOverride'>;
  now: () => number;
  /** Null when no renderer exists: the selector then returns the provisional tier without persisting it. */
  benchmark: RunBenchmark | null;
  /** The backend that initialised, for `desktop-ultra` promotion. */
  backend: RenderBackend | null;
  tiers?: Readonly<Record<QualityTierId, QualityTier>>;
}

export interface Selection {
  decision: TierDecision;
  /** True when a stored decision was used and no benchmark ran. */
  reused: boolean;
}

export class TierSelector {
  private readonly d: { -readonly [K in keyof TierSelectorDeps]: TierSelectorDeps[K] };
  private readonly tiers: Readonly<Record<QualityTierId, QualityTier>>;

  constructor(deps: TierSelectorDeps) {
    this.d = { ...deps };
    this.tiers = deps.tiers ?? TIERS;
  }

  /** Supplies the benchmark runner once the renderer exists (the stored-decision check needs no renderer). */
  useBenchmark(run: RunBenchmark, backend: RenderBackend | null): void {
    this.d.benchmark = run;
    this.d.backend = backend;
  }

  private decision(tier: QualityTierId, source: TierDecision['source'], benchmark?: BenchmarkResult): TierDecision {
    const p = this.d.profile;
    return {
      v: 1,
      tier,
      source,
      decidedAt: this.d.now(),
      build: this.d.build,
      uaHash: p.uaHash,
      adapterHash: p.adapterHash,
      c13: C13_VERSION,
      ...(benchmark ? { benchmark } : {}),
    };
  }

  /** The provisional tier for this device. */
  provisional(): QualityTierId {
    return provisionalTier(this.d.profile);
  }

  /**
   * Everything that decides the tier without a renderer: the `?tier=` override (QA builds only), the Settings override, and a
   * stored decision for the same build, UA and adapter. Null means a benchmark is needed.
   */
  async resolve(): Promise<Selection | null> {
    // 1. `?tier=` works in QA builds only (parseQaFlags already returns null elsewhere; this is the second guard).
    if (this.d.qa.enabled && this.d.qa.tier) {
      return { decision: this.decision(this.d.qa.tier, 'url-override'), reused: false };
    }
    // 2. Settings override.
    const override = this.d.settings.tierOverride;
    if (override !== 'auto') return { decision: this.decision(override, 'user-override'), reused: false };
    // 3. A stored decision for the same build, UA and adapter.
    const stored = await this.d.store.getTierDecision();
    if (stored && stored.build === this.d.build && stored.uaHash === this.d.profile.uaHash && stored.adapterHash === this.d.profile.adapterHash) {
      return { decision: stored, reused: true };
    }
    return null;
  }

  async select(): Promise<Selection> {
    const early = await this.resolve();
    if (early) return early;
    return this.benchmarkSelection();
  }

  /** Provisional tier, then the benchmark (when a renderer exists); the result is persisted. */
  async benchmarkSelection(): Promise<Selection> {
    const provisional = this.provisional();
    if (!this.d.benchmark) return { decision: this.decision(provisional, 'auto-provisional'), reused: false };
    const decision = await this.benchmarkFrom(provisional, this.d.benchmark);
    await this.d.store.putTierDecision(decision);
    return { decision, reused: false };
  }

  private async benchmarkFrom(start: QualityTierId, run: RunBenchmark): Promise<TierDecision> {
    let tier: QualityTierId = start;
    let result = await run(this.tiers[tier]);
    for (let steps = 0; !result.passed && steps < MAX_STEP_DOWNS; steps++) {
      const next = stepDownTier(tier);
      if (!next) break;
      tier = next;
      result = await run(this.tiers[tier]);
    }
    if (tier === 'desktop' && result.passed && result.p90Ms <= ULTRA_P90_MS && this.ultraEligible()) {
      return this.decision('desktop-ultra', 'auto-benchmark', result);
    }
    return this.decision(tier, 'auto-benchmark', result);
  }

  private ultraEligible(): boolean {
    const a = this.d.profile.signals.adapter;
    return this.d.backend === 'webgpu' && a !== null && !a.isFallbackAdapter;
  }

  /**
   * Abnormal-exit demotion (pwa section 9): one rung down, recorded with source `abnormal-exit-demotion`. Returns null at the
   * floor (`mobile-low`) or for an XR tier.
   */
  async demote(current: QualityTierId, source: TierDecision['source'] = 'abnormal-exit-demotion'): Promise<TierDecision | null> {
    const next = stepDownTier(current);
    if (!next) return null;
    const decision = this.decision(next, source);
    await this.d.store.putTierDecision(decision);
    return decision;
  }
}

/** Whether a benchmark p90 passes a tier's frame budget (shared by the selector tests and the perf tooling). */
export function benchmarkPasses(tier: QualityTier, p90Ms: number): boolean {
  return p90Ms <= tier.budget.frame.frameBudgetMs * BENCHMARK_TOLERANCE;
}
