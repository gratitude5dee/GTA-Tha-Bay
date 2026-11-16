import { classifyDevice, type DynamicQuality, type QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { EvictionRegistry } from '../../src/platform/memory/eviction.ts';
import { HARD_SUSTAIN_MS, MemoryBudget, RESTORE_AFTER_MS, type MemoryReading } from '../../src/platform/memory/memory-budget.ts';
import { QualityServiceImpl } from '../../src/platform/quality-service.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { uaFixture } from './fakes.ts';

/** Lets the queued `setTier` promise chain run. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A budget over a fake source at the `mobile` caps (600 MB accounted heap) and a world with `steps` radius steps. */
function rig(o: { tier?: QualityTierId; steps?: number; safe?: boolean } = {}) {
  const profile = classifyDevice(uaFixture('iphone-safari'));
  const applied: string[] = [];
  const quality = new QualityServiceImpl({
    profile,
    backend: 'webgl2',
    initial: o.tier ?? 'mobile',
    safeAtStart: o.safe ?? true,
    apply: (next, prev, reason) => {
      applied.push(`${prev.id}>${next.id}:${reason}`);
    },
  });
  const events: string[] = [];
  quality.onMemoryPressure((l) => events.push(l));
  const reading: MemoryReading = { texturesMB: 0, gpuMB: 0, heapMB: 0, mediaMB: 0 };
  let radius = 0;
  const steps = o.steps ?? 2;
  const calls = { drop: 0, restore: 0 };
  const evictors = new EvictionRegistry();
  const evicted: string[] = [];
  evictors.register('chunks', ({ level }) => {
    evicted.push(`chunks:${level}`);
    return 12;
  });
  evictors.register('textures', ({ level }) => {
    evicted.push(`textures:${level}`);
  });
  const mem = new MemoryBudget({
    quality,
    read: () => ({ ...reading }),
    evictors,
    actions: {
      dropRadius: () => {
        calls.drop += 1;
        if (radius >= steps) return false;
        radius += 1;
        return true;
      },
      restoreRadius: () => {
        calls.restore += 1;
        radius = 0;
      },
    },
  });
  return { quality, mem, reading, events, evicted, calls, applied, radius: () => radius, caps: TIERS[o.tier ?? 'mobile'].budget.memory };
}

describe('MemoryBudget (AC-3)', () => {
  it('stays quiet under 85 % of every cap', () => {
    const { mem, reading, events, caps } = rig();
    reading.heapMB = caps.maxAccountedHeapMB * 0.84;
    reading.gpuMB = caps.maxGpuResourceMB * 0.5;
    expect(mem.sample(1000)).toBe('none');
    expect(events).toEqual([]);
  });

  it('fires soft once at 85 % with the eviction callbacks and a raised textureMipBias', () => {
    const { mem, reading, events, evicted, quality, caps } = rig();
    reading.heapMB = caps.maxAccountedHeapMB * 0.86;
    expect(mem.sample(1000)).toBe('soft');
    expect(mem.sample(2000)).toBe('soft');
    expect(mem.sample(3000)).toBe('soft');
    expect(events).toEqual(['soft']);
    expect(evicted).toEqual(['chunks:soft', 'textures:soft']);
    expect(quality.dynamic.textureMipBias).toBe(0.5);
    expect(mem.evictors.freedMB).toBe(12);
  });

  it('fires hard once at 95 % and drops the streaming radius one step', () => {
    const { mem, reading, events, calls, radius, caps } = rig();
    reading.heapMB = caps.maxAccountedHeapMB * 0.86;
    mem.sample(1000);
    reading.heapMB = caps.maxAccountedHeapMB * 0.96;
    expect(mem.sample(2000)).toBe('hard');
    expect(events).toEqual(['soft', 'hard']);
    expect(calls.drop).toBe(1);
    expect(radius()).toBe(1);
    // within the 2 s gap nothing more happens
    mem.sample(3000);
    expect(calls.drop).toBe(1);
    expect(events).toEqual(['soft', 'hard']);
  });

  it('a jump straight to 95 % is soft, then hard, each once', () => {
    const { mem, reading, events, caps } = rig();
    reading.gpuMB = caps.maxGpuResourceMB * 0.99;
    mem.sample(0);
    expect(events).toEqual(['soft', 'hard']);
    expect(mem.state().worst).toBe('gpu');
  });

  it('keeps stepping the radius every 2 s while hard, then asks for the next tier at a safe point after 10 s at the floor', async () => {
    const { mem, reading, calls, radius, applied, quality, caps } = rig({ steps: 2 });
    reading.heapMB = caps.maxAccountedHeapMB * 0.97;
    let t = 0;
    mem.sample(t);
    expect(radius()).toBe(1);
    t += 2000;
    mem.sample(t);
    expect(radius()).toBe(2);
    t += 2000;
    mem.sample(t); // refused: at the floor
    expect(mem.state(t).radiusAtFloor).toBe(true);
    const floorAt = t;
    while (t - floorAt < HARD_SUSTAIN_MS - 1000) {
      t += 1000;
      mem.sample(t);
    }
    await flush();
    expect(applied).toEqual([]);
    t += 2000;
    mem.sample(t);
    await flush();
    expect(applied).toEqual(['mobile>mobile-low:memory-pressure']);
    expect(quality.tier.id).toBe('mobile-low');
    expect(calls.drop).toBeGreaterThanOrEqual(3);
  });

  it('holds the demotion request while no safe point is open', async () => {
    const { mem, reading, applied, quality, caps } = rig({ steps: 1, safe: false });
    reading.heapMB = caps.maxAccountedHeapMB * 0.97;
    for (let t = 0; t <= 20_000; t += 1000) mem.sample(t);
    await flush();
    expect(applied).toEqual([]);
    quality.setSafePoint(true);
    mem.sample(21_000);
    await flush();
    expect(applied).toEqual(['mobile>mobile-low:memory-pressure']);
  });

  it('never goes below mobile-low', async () => {
    const { mem, reading, applied, caps } = rig({ tier: 'mobile-low', steps: 1 });
    reading.heapMB = caps.maxAccountedHeapMB * 0.97;
    for (let t = 0; t <= 30_000; t += 1000) mem.sample(t);
    await flush();
    expect(applied).toEqual([]);
  });

  it('ends the level only after 10 s under 80 %, restoring the radius once', () => {
    const { mem, reading, calls, caps } = rig();
    reading.heapMB = caps.maxAccountedHeapMB * 0.9;
    mem.sample(0);
    expect(mem.level).toBe('soft');
    reading.heapMB = caps.maxAccountedHeapMB * 0.82; // between 80 and 85: holds
    mem.sample(5000);
    expect(mem.level).toBe('soft');
    reading.heapMB = caps.maxAccountedHeapMB * 0.5;
    mem.sample(6000);
    mem.sample(6000 + RESTORE_AFTER_MS - 1);
    expect(mem.level).toBe('soft');
    mem.sample(6000 + RESTORE_AFTER_MS);
    expect(mem.level).toBe('none');
    expect(calls.restore).toBe(1);
  });

  it('QA setExtraMB adds to the accounted heap and clears with 0', () => {
    const { mem, caps, events } = rig();
    mem.setExtraMB(caps.maxAccountedHeapMB * 0.9);
    expect(mem.sample(0)).toBe('soft');
    expect(mem.state().injectedMB).toBeCloseTo(caps.maxAccountedHeapMB * 0.9);
    mem.setExtraMB(0);
    mem.sample(1000);
    expect(mem.state().injectedMB).toBe(0);
    expect(events).toEqual(['soft']);
  });

  it('keeps the mip bias at the tier floor and tolerates a throwing evictor', () => {
    const { mem, reading, quality, caps } = rig();
    mem.evictors.register('bad', () => {
      throw new Error('broken cache');
    });
    quality.setDynamic({ ...(quality.dynamic as DynamicQuality), textureMipBias: TIERS.mobile.dynamic.floor.textureMipBias });
    reading.heapMB = caps.maxAccountedHeapMB * 0.9;
    expect(() => mem.sample(0)).not.toThrow();
    expect(quality.dynamic.textureMipBias).toBe(TIERS.mobile.dynamic.floor.textureMipBias);
  });
});
