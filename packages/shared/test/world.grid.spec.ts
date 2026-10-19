import { describe, expect, it } from 'vitest';
import {
  ORIGIN, GRID_EDGE_M, GRID_MIN_M, activeSlots, ambientKey, ancestorKey, chunkBounds, chunkKeyAt, chunkKeyOf, densityCap,
  enuFromLatLng, latLngFromEnu, packRefOf, parseChunkKey, signalAspect, type ChunkKey, type SignalProgram,
} from '../src/index.ts';

describe('C08 grid and keys', () => {
  it('puts City Hall at the centre of chunk 9/256/256', () => {
    expect(chunkKeyAt(9, 0, 0)).toBe('9/256/256');
    expect(chunkKeyOf(37.7793, -122.4193)).toBe('9/256/256');
    expect(chunkBounds('9/256/256')).toEqual({ minX: -128, minZ: -128, maxX: 128, maxZ: 128 });
    expect(GRID_MIN_M + GRID_EDGE_M).toBe(65408);
  });

  it('names pack refs by host tile, block and region', () => {
    expect(packRefOf('9/257/257', 'p0')).toBe('world_pack/p0-64-64');
    expect(packRefOf('9/257/257', 'l0')).toBe('world_pack/l0-64-64');
    expect(packRefOf('9/257/257', 'l1')).toBe('world_pack/l1-16-16');
    expect(packRefOf('9/257/257', 'l2')).toBe('world_pack/l2-4-4');
  });

  it('rejects malformed keys', () => {
    expect(parseChunkKey('9/1000/1')).toBeNull();
    expect(parseChunkKey('8/1/1')).toBeNull();
    expect(parseChunkKey('9/1/x')).toBeNull();
    expect(parseChunkKey('7/64/65')).toEqual({ z: 7, x: 64, y: 65 });
  });

  it('computes ancestors with a shift (no ** in sim code)', () => {
    for (let d = 0; d <= 6; d++) expect(1 << d).toBe(Math.pow(2, d));
    expect(ancestorKey('9/257/256', 7)).toBe('7/64/64');
    expect(ancestorKey('9/257/256', 5)).toBe('5/16/16');
    expect(ancestorKey('9/257/256', 3)).toBe('3/4/4');
    expect(ancestorKey('9/0/0', 3)).toBe('3/0/0');
  });

  it('round-trips lat/lng and ENU within 1e-9 degrees', () => {
    for (const [lat, lng] of [[37.7793, -122.4193], [37.8199, -122.4783], [37.7, -122.52], [37.35, -121.9]] as const) {
      const p = enuFromLatLng(lat, lng);
      const q = latLngFromEnu(p.x, p.z);
      expect(Math.abs(q.lat - lat)).toBeLessThan(1e-9);
      expect(Math.abs(q.lng - lng)).toBeLessThan(1e-9);
    }
    const o = enuFromLatLng(ORIGIN.lat, ORIGIN.lng);
    expect(o.x).toBe(0);
    expect(Math.abs(o.z)).toBe(0);
  });

  it('tiles the plane: every point is inside the bounds of its own chunk', () => {
    for (const [x, z] of [[0, 0], [127.9, -127.9], [128, 128], [-5000, 4000], [9000.5, -6000.5]] as const) {
      const k = chunkKeyAt(9, x, z) as ChunkKey;
      const b = chunkBounds(k);
      expect(x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ).toBe(true);
    }
  });

  it('builds ambient keys', () => {
    expect(ambientKey('9/256/256', 12)).toBe('amb:9/256/256:12');
  });
});

describe('signalAspect', () => {
  const p: SignalProgram = {
    id: 0, cycleTicks: 3600, offsetTicks: 0, pedWalkTicks: 0,
    phases: [
      { startTick: 0, greenTicks: 1500, amberTicks: 240, clearTicks: 60, movements: [0, 1] },
      { startTick: 1800, greenTicks: 1500, amberTicks: 240, clearTicks: 60, movements: [3] },
    ],
  };
  it('gives green, amber, red and dark at the phase boundaries', () => {
    expect(signalAspect(p, 0, 0, false)).toBe('green');
    expect(signalAspect(p, 1499, 0, false)).toBe('green');
    expect(signalAspect(p, 1500, 0, false)).toBe('amber');
    expect(signalAspect(p, 1739, 0, false)).toBe('amber');
    expect(signalAspect(p, 1740, 0, false)).toBe('red');
    expect(signalAspect(p, 1800, 0, false)).toBe('red');
    expect(signalAspect(p, 1800, 3, false)).toBe('green');
    expect(signalAspect(p, 3600, 0, false)).toBe('green');
    expect(signalAspect(p, 100, 0, true)).toBe('dark');
    expect(signalAspect(p, 100, 9, false)).toBe('red');
  });
  it('applies the offset', () => {
    expect(signalAspect({ ...p, offsetTicks: 1500 }, 0, 0, false)).toBe('amber');
  });
});

describe('activeSlots', () => {
  it('never grows as tierFactor falls', () => {
    for (const capacity of [0, 1, 8, 100, 256]) {
      let prev = Infinity;
      for (let f = 1.5; f >= 0; f -= 0.05) {
        const n = activeSlots(capacity, f, 1, 1, 1);
        expect(n).toBeLessThanOrEqual(prev);
        expect(n).toBeLessThanOrEqual(densityCap(capacity, f));
        prev = n;
      }
    }
  });
  it('is capped by capacity', () => {
    expect(activeSlots(100, 1, 1.5, 1.5, 1.5)).toBe(100);
    expect(activeSlots(100, 0.5, 1, 1, 1)).toBe(50);
  });
});
