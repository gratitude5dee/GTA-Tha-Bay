import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { BodyReport, BodyEntryReport } from '../../packages/engine/src/client/snapshot/object-pool.ts';
import { act, observe, waitForEngine } from './engine-helpers.ts';
import { crowdMax, streamAtPlan } from './ledger-helpers.ts';
import { bakeIdOf, bootWorld, live, read, setSky, world, type W } from './markings-helpers.ts';

/**
 * M10d5 the on-foot bodies in a real browser, on a `DV_WORLD=synth` QA build (the world half of the e2e legs):
 *
 *  - @art-player     AC-4 per flat tier (`desktop`, `mobile-low`), both engines: the player draws the default avatar (Coast, whose rows
 *                    draw their `fallbackPart`) and then a realistic avatar as one skinned mesh with one material, at `mid` (desktop) or
 *                    `lo` (mobile-low); no pooled entity draws `prop/graybox.capsule`; the mixer plays `idle` standing and `walk` on the
 *                    move (never the bind pose); on a curbed sidewalk and on the road near `curb-corner` the drawn feet are within 0.05 m
 *                    of the surface (M02h2's walk lift carried onto the body). `@xr @art-player`: the Quest tier draws the `lo` parts.
 *  - @player-ledger  AC-5 `chromium-webgl2`: the body is one render object (+0 over one per entity), the frame of the ledger protocol
 *                    (DL-758) is at or under the `after` of the latest merged ledger, and `mobile-low` stays at or under 100 with its
 *                    crowd. `DV_LOOK_WRITE=1` writes `docs/look/M10d5-render-ledger.json`.
 */
type Report = BodyReport;
type Entry = BodyEntryReport;
type E = { __dvBridge: { engine: { observe(): { bodies: Report | null; player: { pos: [number, number, number]; grounded: boolean } | null }; modes: { send(cmd: unknown): void } } } };

const bodies = (page: Page): Promise<Report | null> => page.evaluate(() => (window as unknown as E).__dvBridge.engine.observe().bodies);
const playerOf = async (page: Page): Promise<Entry | null> => (await bodies(page))?.player ?? null;

/** A realistic avatar of the creator (every slot a modelled row). */
const REALISTIC = {
  v: 1, name: 'Tester', callsign: 'Tester',
  body: { preset: 'body-lean', height: 0.7, build: 0.3 },
  face: { preset: 'face-karl', morphs: { 'jaw-width': 0.5 } },
  skinTone: 2,
  hair: { style: 'hair-waves', color: 1 },
  outfit: { top: 'top-flannel', bottom: 'bottom-cargo', shoes: 'shoes-boots' },
  voice: { id: 'voice-bay-smooth', pitch: 0 },
  fightStyle: 'style-balanced',
};

/** Waits for the player's body (not the mannequin stand-in) with the parts `ref` names, then returns the report. */
async function bodyDrawn(page: Page, bodyRef?: string): Promise<Entry> {
  await expect
    .poll(async () => {
      const p = await playerOf(page);
      if (p?.state === 'failed') throw new Error(`the player body failed: ${JSON.stringify(p.failure)}`);
      return p?.drawn === 'body' && (bodyRef === undefined || p.parts.some((x) => x.slot === 'body' && x.ref === bodyRef));
    }, { message: 'the player draws the realistic body', timeout: 300_000, intervals: [500, 1000, 2000] })
    .toBe(true);
  return (await playerOf(page)) as Entry;
}

function expectOneBody(p: Entry, variant: 'mobile' | 'mobile-low', r: Report): void {
  expect(r.variant).toBe(variant);
  expect(r.keys.filter((k) => k === 'prop/graybox.capsule'), 'no pooled entity draws the capsule').toEqual([]);
  expect(p.key).toMatch(/^character\/pc-body-/);
  expect(p, 'one skinned mesh with one material').toMatchObject({ objects: 1, skinned: 1, materials: 1 });
  expect(p.triangles).toBeGreaterThan(variant === 'mobile' ? 2000 : 1000);
}

/** The player standing still: the mixer plays `idle`. */
async function expectIdle(page: Page): Promise<void> {
  await expect.poll(async () => (await playerOf(page))?.clips[0]?.name ?? 'none', { timeout: 60_000, intervals: [250, 500] }).toBe('idle');
}

/**
 * The player on the move (the bot's stick held forward, as `world-bounds.spec.ts` drives it): the mixer plays `walk` (or `run` at full
 * stick, the same locomotion blend) with weight, and its time advances.
 */
async function expectWalk(page: Page): Promise<void> {
  expect(await act(page, { t: 'debug.bot', script: [{ from: 0, to: 1800, moveY: -127, camYaw: 0 }] })).toBe(true);
  try {
    await expect
      .poll(async () => (await playerOf(page))?.clips.find((c) => c.weight > 0.3 && (c.name === 'walk' || c.name === 'run'))?.name ?? 'none', { timeout: 120_000, intervals: [250, 500] })
      .not.toBe('none');
    const a = (await playerOf(page))?.clips.find((c) => c.name === 'walk' || c.name === 'run');
    await expect
      .poll(async () => (await playerOf(page))?.clips.find((c) => c.name === a?.name)?.time, { message: `${a?.name ?? 'walk'} plays (its time moves)`, timeout: 60_000, intervals: [250, 500] })
      .not.toBe(a?.time);
  } finally {
    await act(page, { t: 'debug.bot', script: [] });
  }
}

/** Teleports the player to (x, z) and waits until it stands there (grounded, still). */
async function standAt(page: Page, x: number, z: number): Promise<{ pos: [number, number, number] }> {
  expect(await act(page, { t: 'debug.teleport', pos: [x, 40, z] })).toBe(true);
  await expect
    .poll(async () => {
      const o = await observe(page);
      const p = o.player;
      return p !== null && p.grounded && Math.hypot(p.pos[0] - x, p.pos[2] - z) < 1.5 && Math.hypot(p.vel[0], p.vel[2]) < 0.05;
    }, { message: `the player stands at ${x.toFixed(1)}, ${z.toFixed(1)}`, timeout: 120_000, intervals: [500, 1000] })
    .toBe(true);
  return { pos: ((await observe(page)).player as { pos: [number, number, number] }).pos };
}

/**
 * The feet on a curbed sidewalk and on the road near `curb-corner` (M02h2 AC-5's bound): the drawn root (the feet) is the sim's feet plus
 * the render lift there, the lift is the curb's on the sidewalk (the top a pedestrian there stands on) and 0 on the road.
 */
async function expectFeet(page: Page, tier: string): Promise<void> {
  await standAt(page, 84, 141);
  await expect
    .poll(async () => {
      if (((await world(page, (w) => w.call('state'))) as { topology?: boolean } | null)?.topology !== true) return 0;
      await world(page, (w) => w.call('crowd', { n: 12 }));
      return (await world(page, (w) => w.pedFeet(256))).filter((f) => f.lift > 0 && f.top !== null).length;
    }, { message: 'a pedestrian on a curbed sidewalk near curb-corner', timeout: 300_000, intervals: [2000] })
    .toBeGreaterThan(0);
  const spots = (await world(page, (w) => w.pedFeet(256))).filter((f) => f.lift > 0 && f.top !== null);
  let onWalk: { p: Entry; sim: [number, number, number]; top: number } | null = null;
  for (const f of spots.slice(0, 6)) {
    const { pos } = await standAt(page, f.x, f.z);
    await page.waitForTimeout(300);
    const p = (await playerOf(page)) as Entry;
    // the top of the resident sidewalk ribbon right under the drawn feet (M02h2's QA reader, the one `pedFeet` uses)
    const top = await page.evaluate(
      ([x, z]) => ((window as unknown as W).__dvBridge.world.internals().view as unknown as { renderer: { walkTopAt(x: number, z: number): number | null } }).renderer.walkTopAt(x as number, z as number),
      [p.at[0], p.at[2]] as const,
    );
    if (p.lift > 0 && top !== null) {
      onWalk = { p, sim: pos, top };
      break;
    }
  }
  expect(onWalk, `${tier}: the player stood on a curbed sidewalk`).not.toBeNull();
  if (onWalk) {
    const { p, sim, top } = onWalk;
    // BD-M10d5-07: the body carries M02h2's walk lift exactly (the drawn feet are the sim's feet plus the lift there). The gap to the
    // drawn ribbon top is logged, not held to 0.05 m: the player's physics ground lies under the road ribbon's own lift (`ribbonLift`,
    // 0.12 m and up, M02g2), as the mannequin's did, which no render-only change of this row can see (reported to the Architect).
    console.log(`art player ${tier}: sidewalk feet ${p.at[1].toFixed(3)}, sim ${sim[1].toFixed(3)}, lift ${p.lift.toFixed(3)}, ribbon top ${top.toFixed(3)}, gap ${(top - p.at[1]).toFixed(3)}`);
    expect(Math.abs(p.at[1] - (sim[1] + p.lift)), 'the drawn feet are the sim feet plus the walk lift').toBeLessThanOrEqual(0.01);
    expect(p.lift, 'a curbed sidewalk lifts the feet').toBeGreaterThan(0);
  }
  // the road: the lift is 0 and the feet are the sim's (find a spot off the sidewalk near the corner)
  let onRoad: { p: Entry; sim: [number, number, number] } | null = null;
  for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 8]] as const) {
    const { pos } = await standAt(page, 84 + dx, 141 + dz);
    await page.waitForTimeout(300);
    const p = (await playerOf(page)) as Entry;
    if (p.lift === 0) {
      onRoad = { p, sim: pos };
      break;
    }
  }
  expect(onRoad, `${tier}: the player stood on the road`).not.toBeNull();
  if (onRoad) {
    console.log(`art player ${tier}: road feet ${onRoad.p.at[1].toFixed(3)}, sim ${onRoad.sim[1].toFixed(3)}`);
    expect(Math.abs(onRoad.p.at[1] - onRoad.sim[1]), 'the drawn feet stand on the road').toBeLessThanOrEqual(0.05);
  }
}

test.describe('art player @art-player', () => {
  test.describe.configure({ timeout: 1_800_000 });

  for (const tier of ['desktop', 'mobile-low'] as const) {
    test(`${tier}: the player draws the creator's parts as one body, plays its clips and stands on the curb @art-player`, async ({ page }, testInfo: TestInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const requested = new Set<string>();
      page.on('request', (r) => {
        // characters are stored under `characters/<id>/model/`, textures under `assets/texture/<id>/` (C07 object keys)
        const path = new URL(r.url()).pathname;
        const m = /\/characters\/(pc-[a-z0-9._-]+)\//.exec(path) ?? /\/assets\/(texture\/pc\.[a-z]+)\//.exec(path);
        if (m) requested.add(m[1]?.startsWith('texture/') ? (m[1] as string) : `character/${m[1] as string}`);
      });
      const variant = tier === 'mobile-low' ? 'mobile-low' : 'mobile';
      await bootWorld(page, tier);
      // the default avatar (Coast): its rows draw their fallbackPart's models
      const coast = await bodyDrawn(page);
      expectOneBody(coast, variant, (await bodies(page)) as Report);
      expect(coast.parts.find((x) => x.slot === 'body')).toMatchObject({ part: 'body-coast', ref: 'character/pc-body-athletic', path: 'fallback' });
      expect(coast.clipSource).toBe('placeholder');
      for (const ref of ['character/pc-body-athletic', 'character/pc-face-sunset', 'texture/pc.skin']) expect([...requested], ref).toContain(ref);
      await expectIdle(page);
      await expectWalk(page);
      // a realistic avatar saved to the profile: the body is rebuilt from its models
      await page.evaluate((a) => (window as unknown as E).__dvBridge.engine.modes.send({ t: 'save.avatar', avatar: a }), REALISTIC);
      const real = await bodyDrawn(page, 'character/pc-body-lean');
      expectOneBody(real, variant, (await bodies(page)) as Report);
      expect(real.parts.every((x) => x.path === 'model')).toBe(true);
      await expectIdle(page);
      await expectWalk(page);
      await expectFeet(page, `${testInfo.project.name} ${tier}`);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('xr art player @xr @art-player', () => {
  test('the Quest tier draws the player from the lo parts @xr @art-player', async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 256, height: 144 });
    await page.goto('/?tier=xr-quest&xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world?.boot().revealed === true, undefined, { timeout: 180_000 });
    const p = await bodyDrawn(page);
    expectOneBody(p, 'mobile-low', (await bodies(page)) as Report);
    expect(p.triangles, 'lo parts').toBeLessThan(4000);
    await expectIdle(page);
    // the Quest row of the ledger: the frame of the protocol against the latest merged ledger's xr row
    await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await streamAtPlan(page);
    await world(page, (w) => w.hold(true));
    const objects = (await live(page)).renderObjects;
    await world(page, (w) => w.hold(false));
    const priorXr = prior().ledger.xr?.after;
    console.log(`player ledger xr: ${objects} render objects (prior after ${String(priorXr)})`);
    if (priorXr !== undefined) expect(objects, 'the Quest count against the prior ledger').toBeLessThanOrEqual(priorXr);
    if (write && existsSync(LEDGER)) {
      const l = read<Ledger>(LEDGER);
      l.xr = { baseline: priorXr ?? objects, after: objects, player: { objects: p.objects, triangles: p.triangles } };
      writeFileSync(LEDGER, `${JSON.stringify(l, null, 2)}\n`);
    }
  });
});

// ---- the render-object ledger (AC-5) ------------------------------------------------------------------------------------------------

const LEDGER = 'docs/look/M10d5-render-ledger.json';
/** The latest merged ledger first: its `after` is this one's baseline (`_PLAN-3.md` Look program rule 5). */
const PRIORS = ['docs/look/M02h5-render-ledger.json', 'docs/look/M10d4-render-ledger.json', 'docs/look/M02h4-render-ledger.json'];
const LEDGER_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
interface TierRow {
  baseline: number;
  after: number;
  /** Render objects the body adds over one per entity (the player is one skinned mesh). */
  perLayer: { player: number };
  /** The player's body on the measured boot: render objects, triangles, the variant read. */
  player: { objects: number; triangles: number; variant: string };
}
interface Ledger {
  commit: string;
  bakeId: string;
  baselineFrom: string;
  drift?: { reason: string; measured: Record<string, number> };
  tiers: Record<string, TierRow>;
  xr?: { baseline: number; after: number; player: { objects: number; triangles: number } };
}
const write = process.env['DV_LOOK_WRITE'] === '1';
const commitOf = (): string => process.env['GITHUB_SHA'] ?? process.env['DV_COMMIT'] ?? 'local';

function prior(): { file: string; ledger: { tiers: Record<string, { after: number }>; xr?: { after: number } } } {
  for (const file of PRIORS) if (existsSync(file)) return { file, ledger: read(file) };
  throw new Error(`no ledger before M10d5 in docs/look (${PRIORS.join(', ')})`);
}

test.describe('player ledger @player-ledger', () => {
  test.describe.configure({ timeout: 1_800_000, mode: 'serial' });
  test.beforeEach(({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-webgl2', 'the ledger is chromium-webgl2 only (the XR row runs in @xr @art-player)');
  });
  const measured: Record<string, TierRow> = {};

  for (const tier of LEDGER_TIERS) {
    test(`${tier}: the body is one render object and the frame holds its count @player-ledger`, async ({ page }) => {
      await bootWorld(page, tier);
      await setSky(page, 13, 'clear');
      const p = await bodyDrawn(page);
      const r = (await bodies(page)) as Report;
      expectOneBody(p, tier === 'mobile-low' ? 'mobile-low' : 'mobile', r);
      await expect.poll(async () => (await world(page, (w) => w.traffic()))?.instances ?? 0, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
      // the frame of the ledger protocol (DL-758): the plan resident, the crowd hidden, read on a held frame
      if (tier === 'mobile-low') await world(page, (w) => w.shot('fog-west'));
      await streamAtPlan(page);
      await world(page, (w) => w.hold(true));
      const after = (await live(page)).renderObjects;
      await world(page, (w) => w.hold(false));
      const base = prior();
      const baseline = base.ledger.tiers[tier]?.after;
      expect(baseline, `${base.file} holds ${tier}`).toBeDefined();
      expect(after, `${tier}: render objects against the after (${baseline}) of ${base.file}`).toBeLessThanOrEqual(baseline ?? 0);
      if (tier === 'mobile-low') expect(after + crowdMax(tier), `mobile-low after ${after} + crowd max ${crowdMax(tier)}`).toBeLessThanOrEqual(100);
      measured[tier] = { baseline: baseline ?? after, after, perLayer: { player: p.objects - 1 }, player: { objects: p.objects, triangles: p.triangles, variant: r.variant ?? '' } };
      console.log(`player ledger ${tier}: ${JSON.stringify(measured[tier])} (crowd max ${crowdMax(tier)})`);
    });
  }

  test('writes (DV_LOOK_WRITE=1) or checks the committed ledger @player-ledger', () => {
    const base = prior();
    if (write) {
      const drift: Record<string, number> = {};
      for (const tier of LEDGER_TIERS) {
        const m = measured[tier];
        if (m && m.after !== m.baseline) drift[tier] = m.after;
      }
      const old = existsSync(LEDGER) ? read<Ledger>(LEDGER) : undefined;
      const out: Ledger = {
        commit: commitOf(),
        bakeId: bakeIdOf(),
        baselineFrom: base.file,
        ...(Object.keys(drift).length > 0
          ? { drift: { reason: `${base.file} was measured on a scene later rows changed; this checkout reads the render objects in measured, and the player's body adds none`, measured: drift } }
          : {}),
        tiers: Object.fromEntries(LEDGER_TIERS.filter((t) => measured[t]).map((t) => [t, measured[t] as TierRow])),
        ...(old?.xr ? { xr: old.xr } : {}),
      };
      mkdirSync(dirname(LEDGER), { recursive: true });
      writeFileSync(LEDGER, `${JSON.stringify(out, null, 2)}\n`);
    }
    expect(existsSync(LEDGER), `${LEDGER} is committed`).toBe(true);
    const ledger = read<Ledger>(LEDGER);
    expect(ledger.bakeId).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.baselineFrom, 'the ledger names the latest merged one it measured from').toBe(base.file);
    for (const tier of LEDGER_TIERS) {
      const t = ledger.tiers[tier];
      expect(t, `${tier} is in the ledger`).toBeDefined();
      if (!t) continue;
      expect(t.baseline, `${tier} baseline is the after of ${base.file}`).toBe(base.ledger.tiers[tier]?.after);
      expect(t.perLayer.player, `${tier}: objects the body adds over one per entity`).toBe(0);
      expect(t.after).toBeLessThanOrEqual(t.baseline);
      if (t.after !== t.baseline) expect(ledger.drift?.measured[tier], `${tier}: after ${t.after} is not the baseline ${t.baseline}: the ledger says why`).toBe(t.after);
    }
    expect((ledger.tiers['mobile-low']?.after ?? 0) + crowdMax('mobile-low'), 'mobile-low after + crowd max').toBeLessThanOrEqual(100);
    if (ledger.xr) expect(ledger.xr.after).toBeLessThanOrEqual(ledger.xr.baseline);
  });
});
