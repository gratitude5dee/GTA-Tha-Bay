/**
 * M05c1: the mission store and the start triggers of the story controller. The catalog is the compiled Act 1 missions; the harness is
 * the headless mission world. Missions open one after the other (`requires`), the first starts by itself (`auto`), a marker mission
 * starts only inside its hours, the Jobs list (`mode.story.jobs`) follows the states, and a running mission is never replaced.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { MissionIR } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { describe, expect, it } from 'vitest';
import { StoryController } from '../src/mode.ts';
import type { MissionStore, CatalogPayload, JobRow } from '../src/missions/store.ts';
import { makeHarness, type Harness } from './harness.ts';

const root = path.resolve(import.meta.dirname, '../../../..');
const data = path.join(root, 'assets/src/data');
const json = <T>(...p: string[]): T => JSON.parse(readFileSync(path.join(data, ...p), 'utf8')) as T;

function payload(over: Partial<CatalogPayload> = {}): CatalogPayload {
  const dirs = readdirSync(data);
  return {
    missions: dirs.filter((d) => /^mission\.m\.a1\./.test(d)).map((d) => json<MissionIR>(d, 'mission.json')),
    directors: dirs.filter((d) => /^director\.m\.a1\./.test(d)).map((d) => json<DirectorScript>(d, 'director.json')),
    cutscenes: [],
    lines: json<{ text: Record<string, string> }>('lines.1.en', 'lines.json').text,
    ...over,
  };
}

function rig(hour = 12, over: Partial<CatalogPayload> = {}): { h: Harness; c: StoryController; store: MissionStore } {
  const h = makeHarness({ flags: { beats: 'instant' } });
  (h.ctx.clock as unknown as { env: () => unknown }).env = () => ({ hour, night: 0, dark: 0, weather: 'clear', next: 'clear', blend: 0, fogBankM: 0, rain: 0 });
  const p = payload(over);
  const c = new StoryController({ qa: false, bootConfig: () => ({ story: p }) });
  c.attach(h.ctx, h.story);
  return { h, c, store: c.store as MissionStore };
}

const rows = (h: Harness): JobRow[] => (h.vm.get('mode.story.jobs') ?? []) as unknown as JobRow[];

describe('the mission store', () => {
  it('holds the six Act 1 missions in order; only the first is open on a new game', () => {
    const { h, store } = rig();
    expect(store.entries.map((e) => e.ir.id)).toEqual(['m.a1.01', 'm.a1.02', 'm.a1.03', 'm.a1.04', 'm.a1.05', 'm.a1.06']);
    const r = store.rows(h.story, h.ctx, null);
    expect(r.map((x) => [x.id, x.state, x.trigger])).toEqual([
      ['m.a1.01', 'available', 'auto'],
      ['m.a1.02', 'locked', 'phone'],
      ['m.a1.03', 'locked', 'marker'],
      ['m.a1.04', 'locked', 'phone'],
      ['m.a1.05', 'locked', 'phone'],
      ['m.a1.06', 'locked', 'phone'],
    ]);
    expect(r[1]).toMatchObject({ title: 'Surge Pricing', needs: 'Jump Start', giver: 'x_ramos' });
  });

  it('passing a mission opens the next; the active one is marked active', () => {
    const { h, store } = rig();
    h.story.missions['m.a1.01'] = { state: 'passed', medals: 2, bestSec: 61 };
    const r = store.rows(h.story, h.ctx, 'm.a1.02');
    expect(r.slice(0, 4).map((x) => [x.id, x.state])).toEqual([['m.a1.01', 'passed'], ['m.a1.02', 'active'], ['m.a1.03', 'available'], ['m.a1.04', 'locked']]);
    expect(r[0]).toMatchObject({ medals: 2, bestSec: 61 });
  });

  it('the auto mission is due once, only while it is open and not passed', () => {
    const { h, store } = rig();
    expect(store.autoDue(h.story, h.ctx)?.ir.id).toBe('m.a1.01');
    h.story.missions['m.a1.01'] = { state: 'passed' };
    expect(store.autoDue(h.story, h.ctx)).toBeNull();
    expect(rig(12, { triggers: false }).store.autoDue(h.story, h.ctx)).toBeNull();
  });

  it('the sideshow marker works only from 18:00 to 23:00, after m.a1.01', () => {
    const noon = rig(12);
    noon.h.story.missions['m.a1.01'] = { state: 'passed' };
    expect(noon.store.markerCandidates(noon.h.story, noon.h.ctx).map((e) => e.ir.id)).toEqual([]);
    const evening = rig(20);
    expect(evening.store.markerCandidates(evening.h.story, evening.h.ctx)).toEqual([]);
    evening.h.story.missions['m.a1.01'] = { state: 'passed' };
    expect(evening.store.markerCandidates(evening.h.story, evening.h.ctx).map((e) => e.ir.id)).toEqual(['m.a1.03']);
  });
});

describe('the story controller triggers', () => {
  it('starts the auto mission on its own, publishes the Jobs list, and keeps a running mission', () => {
    const { h, c } = rig();
    h.tickNo.n = 0;
    c.advance(h.ctx);
    expect(c.rt?.missionId).toBe('m.a1.01');
    expect(c.rt?.active).toBe(true);
    h.tickNo.n = 30;
    c.advance(h.ctx);
    expect(rows(h).find((r) => r.id === 'm.a1.01')?.state).toBe('active');
    // a second start while it runs is refused
    expect(c.startById('m.a1.02', h.ctx)).toBeNull();
    expect(c.rt?.missionId).toBe('m.a1.01');
  });

  it('starts a phone mission from the Jobs command and refuses a locked or unknown id', () => {
    const { h, c } = rig();
    h.story.missions['m.a1.01'] = { state: 'passed' };
    expect(c.startById('m.a1.99', h.ctx)).toBeNull();
    const res = c.startById('m.a1.02', h.ctx);
    expect(res).toEqual({ ok: true });
    expect(c.rt?.missionId).toBe('m.a1.02');
  });

  it('publishes the Jobs list when the mode enters, before any tick (a pause right after the start stops the ticks; BD-FIX-CI9-W02)', () => {
    const { h } = rig(12, { triggers: false });
    expect(rows(h).map((r) => [r.id, r.state])).toEqual([
      ['m.a1.01', 'available'], ['m.a1.02', 'locked'], ['m.a1.03', 'locked'], ['m.a1.04', 'locked'], ['m.a1.05', 'locked'], ['m.a1.06', 'locked'],
    ]);
  });

  it('QA scenes with the triggers off start nothing by themselves', () => {
    const { h, c } = rig(12, { triggers: false });
    c.advance(h.ctx);
    h.tickNo.n = 30;
    c.advance(h.ctx);
    expect(c.rt).toBeNull();
    expect(rows(h).map((r) => r.id)).toHaveLength(6);
  });
});
