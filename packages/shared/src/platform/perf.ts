import type { AdapterSummary, DeviceClass, DisplayMode, QualityTierId, RenderBackend } from './c13.ts';

/**
 * Perf harness types, copied from 11-platform-perf.md section 4 (C13 1.2). PerfReport is validated by the JSON Schema
 * tools/ci/schemas/perf-report.v1.json.
 */
export interface PerfScenario {
  id: string;                         // 'graybox-walk' (S01 engine graybox, pre-world, DL-065) | 'walk-civic-center' | 'route-ferry-ocean-beach' | 'downtown-rush' | 'story-chase' | 'npc-mission-crowd' | 'fight-stage' | 'xr-walk'
  pathRef: string;                    // camera path file owned by the scenario's milestone (S02, S06, S07)
  durationS: number; warmupS: number; seed: number;
  density: 'off' | 'nominal';         // traffic and peds at the tier budget
}
export interface PerfReport {
  v: 1; build: string; c13: string; createdAt: number /* epoch ms */;
  device: { class: DeviceClass; browser: string; model?: string; uaHash: string;
            adapter: AdapterSummary | null; displayMode: DisplayMode; refreshHz: number | null };
  tier: QualityTierId; backend: RenderBackend; governor: 'on' | 'off'; scenario: PerfScenario;
  frames: { count: number; medianMs: number; p95Ms: number; p99Ms: number; maxMs: number;
            over50ms: number; over2xBudget: number };
  counts: { renderObjectsMax: number; renderObjectsP95: number; gpuDrawCmdsMax: number | null;
            trianglesMax: number; texturesMB: number; gpuResourcesMB: number;   // per view-pass
            /** M06c, scenario `npc-mission-crowd` only: the most named-NPC brains at LOD A and B in the window, the brain cost per sim tick (mean and max, ms) and the ticks measured. */
            npcBrainsAMax?: number; npcBrainsBMax?: number; npcBrainMsMean?: number; npcBrainMsMax?: number; npcBrainTicks?: number };
  memory: { accountedHeapMBMax: number; mediaMBMax: number; webContentEstMB: number | null };
  dynamic: { minRenderScale: number; downgrades: number; upgrades: number; tierChanges: number };
  boot: { warmBootToPlayableS: number | null; coldDownloadMB: number | null;
          /** C13 1.2 (DL-725), world boots only: pack requests, bytes, ms from world-boot start to reveal, request waves and peak requests in flight. */
          requests?: number; bytes?: number; revealMs?: number; waves?: number; inflightPeak?: number };
  errors: { gpuLost: number; uncaptured: number; js: number };
}
export interface Expectation { metric: string; op: '<=' | '>=' | '==' ; value: number | string | boolean }
export interface DeviceChecklist {
  id: string; milestone: string; device: string; urlTemplate: string;   // e.g. https://<preview>/?perf=1&tier=mobile-low
  steps: { id: string; instruction: string; expect?: Expectation[] }[];
  upload: ('perf.json' | 'notes.json')[];
}
