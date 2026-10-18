import { describe, expect, it } from 'vitest';
import { interpolateSnapshots, slerpShortest, type Pose } from '../src/client/snapshot/interpolate.ts';
import { SnapshotView } from '../src/client/snapshot/reader.ts';
import { REC_BYTES, emptyRecord, writeRecord, type SnapshotFrame, type SnapshotRecord } from '../src/sim/transport/snapshot-buffer.ts';

function frame(tick: number, records: Partial<SnapshotRecord>[], side: Record<string, unknown> = {}): SnapshotFrame {
  const bytes = new Uint8Array(records.length * REC_BYTES);
  const view = new DataView(bytes.buffer);
  records.forEach((r, i) => writeRecord(view, i, { ...emptyRecord(), ...r }));
  return { tick, count: records.length, flags: 0, records: bytes, side };
}

const deg = (d: number): number => (d * Math.PI) / 180;
const yaw = (d: number): Partial<SnapshotRecord> => ({ qy: Math.sin(deg(d) / 2), qw: Math.cos(deg(d) / 2) });

describe('snapshot interpolation (AC-9)', () => {
  it('positions lerp by alpha between the previous and the newest snapshot', () => {
    const prev = frame(10, [{ handle: 1, px: 0, py: 0, pz: 0 }, { handle: 2, px: 10, py: 5, pz: -3 }]);
    const cur = frame(11, [{ handle: 1, px: 1, py: 0.5, pz: 0 }, { handle: 2, px: 10, py: 5, pz: -2 }]);
    const out: Pose[] = [];
    for (const alpha of [0, 0.25, 0.5, 1]) {
      expect(interpolateSnapshots(prev, cur, alpha, out)).toBe(2);
      expect(out[0]?.px).toBeCloseTo(alpha, 12);
      expect(out[0]?.py).toBeCloseTo(0.5 * alpha, 12);
      expect(out[1]?.pz).toBeCloseTo(-3 + alpha, 12);
      expect(out[0]?.snapped).toBe(false);
    }
  });

  it('keeps f64 precision far from the origin', () => {
    const prev = frame(1, [{ handle: 1, px: 123_456.000_000_1 }]);
    const cur = frame(2, [{ handle: 1, px: 123_456.000_000_9 }]);
    const out: Pose[] = [];
    interpolateSnapshots(prev, cur, 0.5, out);
    expect(out[0]?.px).toBeCloseTo(123_456.000_000_5, 9);
  });

  it('quaternions take the shortest arc, including when the sign flips between snapshots', () => {
    const out: Pose[] = [];
    // 350 degrees to 10 degrees of yaw: the short way is 20 degrees through 0, not 340 through 180.
    const prev = frame(1, [{ handle: 1, ...yaw(350) }]);
    const cur = frame(2, [{ handle: 1, ...yaw(10) }]);
    interpolateSnapshots(prev, cur, 0.5, out);
    const mid = out[0] as Pose;
    const angle = 2 * Math.atan2(mid.qy, mid.qw);
    expect(Math.abs(Math.sin(angle / 2))).toBeLessThan(1e-6); // halfway is yaw 0 (or 360)
    // Same rotation stored with opposite sign (q and -q): no spin through the long way.
    const neg = frame(2, [{ handle: 1, qy: -(cur.records.length ? Math.sin(deg(10) / 2) : 0), qw: -Math.cos(deg(10) / 2) }]);
    interpolateSnapshots(prev, neg, 0.5, out);
    expect(Math.abs(Math.sin((2 * Math.atan2((out[0] as Pose).qy, (out[0] as Pose).qw)) / 2))).toBeLessThan(1e-6);
    // The result is a unit quaternion.
    const p = out[0] as Pose;
    expect(Math.hypot(p.qx, p.qy, p.qz, p.qw)).toBeCloseTo(1, 6);
  });

  it('slerpShortest matches a known 90 degree turn and is exact at the ends', () => {
    const q = { qx: 0, qy: 0, qz: 0, qw: 1 };
    slerpShortest(0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0.5, q);
    expect(q.qy).toBeCloseTo(Math.sin(deg(45) / 2), 6);
    expect(q.qw).toBeCloseTo(Math.cos(deg(45) / 2), 6);
    slerpShortest(0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, q);
    expect([q.qx, q.qy, q.qz, q.qw]).toEqual([0, 0, 0, 1]);
  });

  it('entities with a tick gap above 3 snap to the newest snapshot', () => {
    const out: Pose[] = [];
    const cur = frame(20, [{ handle: 1, px: 1 }]);
    interpolateSnapshots(frame(17, [{ handle: 1, px: 0 }]), cur, 0.5, out); // gap 3: still blends
    expect(out[0]?.px).toBeCloseTo(0.5, 12);
    expect(out[0]?.snapped).toBe(false);
    interpolateSnapshots(frame(16, [{ handle: 1, px: 0 }]), cur, 0.5, out); // gap 4: snaps
    expect(out[0]?.px).toBe(1);
    expect(out[0]?.snapped).toBe(true);
  });

  it('entities that moved more than 2 m snap, and others in the same snapshot still blend', () => {
    const out: Pose[] = [];
    const prev = frame(5, [{ handle: 1, px: 0 }, { handle: 2, px: 0 }, { handle: 3, px: 0, py: 0, pz: 0 }]);
    const cur = frame(6, [{ handle: 1, px: 2 }, { handle: 2, px: 2.01 }, { handle: 3, px: 1.2, py: 1.2, pz: 1.2 }]);
    interpolateSnapshots(prev, cur, 0.5, out);
    expect(out[0]?.snapped).toBe(false); // exactly 2 m blends
    expect(out[0]?.px).toBeCloseTo(1, 12);
    expect(out[1]?.snapped).toBe(true); // 2.01 m snaps
    expect(out[1]?.px).toBe(2.01);
    expect(out[2]?.snapped).toBe(true); // 3-D distance 2.078 m
  });

  it('a new entity (no match in the previous snapshot) and a missing previous snapshot place at the newest state', () => {
    const out: Pose[] = [];
    const cur = frame(8, [{ handle: 1, px: 4 }, { handle: 9, px: 7 }]);
    interpolateSnapshots(frame(7, [{ handle: 1, px: 3 }]), cur, 0.5, out);
    expect(out[0]?.px).toBeCloseTo(3.5, 12);
    expect(out[1]?.px).toBe(7);
    expect(out[1]?.snapped).toBe(true);
    interpolateSnapshots(null, cur, 0.5, out);
    expect(out[0]?.px).toBe(4);
    expect(out[0]?.snapped).toBe(true);
  });

  it('alpha is clamped to [0, 1]; the pose list is reused between calls', () => {
    const out: Pose[] = [];
    const prev = frame(1, [{ handle: 1, px: 0 }]);
    const cur = frame(2, [{ handle: 1, px: 1 }]);
    interpolateSnapshots(prev, cur, -3, out);
    expect(out[0]?.px).toBe(0);
    const first = out[0];
    interpolateSnapshots(prev, cur, 9, out);
    expect(out[0]?.px).toBe(1);
    expect(out[0]).toBe(first);
  });

  it('SnapshotView collects the renderKey strings from side blocks and counts snaps', () => {
    const view = new SnapshotView();
    expect(view.update(null)).toBe(false);
    const cur = frame(3, [{ handle: 1, renderKey: 5, px: 1 }], { rk: { '5': 'dbg/box/1x1x1' } });
    const prev = frame(2, [{ handle: 1, renderKey: 5, px: 0 }]);
    expect(view.update({ fresh: true, tick: 3, alpha: 0.5, cur, prev })).toBe(true);
    expect(view.keys.get(5)).toBe('dbg/box/1x1x1');
    expect(view.count).toBe(1);
    expect(view.snapped).toBe(0);
    expect(view.poses[0]?.px).toBeCloseTo(0.5, 12);
    // A non-fresh read keeps the keys and re-blends with the new alpha.
    view.update({ fresh: false, tick: 3, alpha: 1, cur, prev });
    expect(view.poses[0]?.px).toBe(1);
  });
});
