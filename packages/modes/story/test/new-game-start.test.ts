/**
 * Fix S (BD-FIX-SPAWN-01): a new game's first auto mission moves the player to its start through the world's teleport, and starts only
 * once the teleport has put the player on the ground there. The owner's report was a player dropped at the resolver's fallback height
 * over ground that was not resident yet, falling through the void while the mission ran at the Yard above it.
 */
import type { StorySlice, TeleportKind, TeleportResult, TeleportTarget } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { at, circle, defineMission, npc, stage, waitFor } from '../src/authoring/index.ts';
import type { CatalogPayload } from '../src/missions/store.ts';
import { StoryController } from '../src/mode.ts';
import { ll, makeHarness, type Harness } from './harness.ts';

const START = { x: 2000, z: 3000 };
const mission = defineMission({
  id: 'm.t.first',
  version: 1,
  district: 'd3',
  cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(START.x + 10, START.z)) }) },
  zones: { z: circle(...ll(START.x, START.z), 5) },
  stages: [stage('a', [waitFor(6000, { id: 'long' })])],
});

interface Asked {
  kind: TeleportKind;
  to: TeleportTarget;
  answer(r: TeleportResult): void;
}

function setup(answer?: (n: number) => TeleportResult | null): { h: Harness; c: StoryController; asked: Asked[]; run(ticks: number): Promise<void> } {
  const h = makeHarness();
  const asked: Asked[] = [];
  (h.ctx.world as unknown as { teleport: unknown }).teleport = {
    request: (kind: TeleportKind, to: TeleportTarget) =>
      new Promise<TeleportResult>((resolve) => {
        const a: Asked = { kind, to, answer: resolve };
        asked.push(a);
        const now = answer?.(asked.length);
        if (now) resolve(now);
      }),
    candidates: () => [],
  };
  const [lat, lng] = ll(START.x, START.z);
  const payload: CatalogPayload = { missions: [mission], directors: [], cutscenes: [], lines: {}, names: {}, autoStart: { lat, lng, yawDeg: 90 }, triggers: true };
  const c = new StoryController({ qa: false, bootConfig: () => ({ story: payload }) });
  c.attach(h.ctx, h.story as unknown as StorySlice);
  const run = async (ticks: number): Promise<void> => {
    for (let i = 0; i < ticks; i++) {
      c.advance(h.ctx);
      h.tickNo.n++;
      await Promise.resolve();
    }
  };
  return { h, c, asked, run };
}

const ok = (): TeleportResult => ({ ok: true, x: START.x, y: 4, z: START.z, yaw: 0 });

describe('new game start (BD-FIX-SPAWN-01)', () => {
  it('asks the teleport for a respawn at the start and starts the mission only once it answers ok', async () => {
    const { h, c, asked, run } = setup();
    await run(16);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.kind).toBe('respawn');
    const to = asked[0]!.to as { x: number; z: number; yaw: number };
    expect(to.x).toBeCloseTo(START.x, 3);
    expect(to.z).toBeCloseTo(START.z, 3);
    expect(to.yaw).toBeCloseTo(Math.PI / 2, 6);
    // the teleport is still streaming the destination: no mission, no other trigger, no second request
    await run(300);
    expect(c.rt).toBeNull();
    expect(asked).toHaveLength(1);
    // the player stands there now: the mission starts on the next trigger pass
    h.put(h.player, START.x, START.z, 4);
    asked[0]!.answer(ok());
    await run(16);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.missionId).toBe('m.t.first');
  });

  it('asks again while the destination is not loaded, then gives up without starting the mission', async () => {
    const { h, c, asked, run } = setup(() => ({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' }));
    await run(2000);
    expect(asked).toHaveLength(5);
    expect(c.rt).toBeNull();
    expect(h.calls.toasts.map((t) => t.text)).toEqual(['mission.startUnreachable']);
    expect(h.calls.telemetry.filter((t) => t.name === 'mission.fail').map((t) => t.props['reason'])).toEqual(['unresolved']);
    // tried once per session: no further requests
    await run(600);
    expect(asked).toHaveLength(5);
  });

  it('a start in the water or out of bounds is not retried and the mission does not start', async () => {
    const { h, c, asked, run } = setup(() => ({ ok: false, reason: 'water', messageKey: 'world.teleport.water' }));
    await run(600);
    expect(asked).toHaveLength(1);
    expect(c.rt).toBeNull();
    expect(h.calls.toasts.map((t) => t.text)).toEqual(['mission.startUnreachable']);
  });

  it('a busy teleport (the boot spawn still settling) is asked again and then succeeds', async () => {
    const { c, asked, run } = setup((n) => (n === 1 ? { ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' } : ok()));
    await run(200);
    expect(asked).toHaveLength(2);
    expect(c.rt?.active).toBe(true);
  });

  it('a player already at the start begins at once, without a teleport', async () => {
    const { h, c, asked, run } = setup();
    h.put(h.player, START.x + 50, START.z, 0);
    await run(16);
    expect(asked).toHaveLength(0);
    expect(c.rt?.active).toBe(true);
  });
});
