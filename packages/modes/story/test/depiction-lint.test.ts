/**
 * M05c1 AC-2: one fixture per rule of the content and depiction lint (03-story-missions.md C11). Each bad mission fails with
 * `E_DEPICTION` or `E_NAME` at the pointer of the node that breaks the rule; the Act 1 missions compile clean under the same lint.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MissionIR } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { compileRealNames } from '../../../shared/src/assets/gates/names.ts';
import { chase, defeat, defineMission, escape, goto, npc, say, stage, at, circle, prop } from '../src/authoring/index.ts';
import { compileMission, lintMission, type CompileEnv } from '../src/compiler/index.ts';
import { baseEnv, LINES, NEAR } from './fixtures/base.ts';

const root = path.resolve(import.meta.dirname, '../../../..');

const mk = (extra: Partial<Parameters<typeof defineMission>[0]> = {}): MissionIR =>
  defineMission({
    id: 'm.t.depict',
    version: 1,
    act: 0,
    district: 'd1',
    title: 'mission.m.t.depict.title',
    cast: { star: npc({ slot: 'RAP_NEW_WAVE', role: 'opponent', spawn: at(NEAR.b[0], NEAR.b[1]) }) },
    zones: { z: circle(NEAR.a[0], NEAR.a[1], 8) },
    stages: [stage('a', [goto('z', { id: 'goto_z' })])],
    ...extra,
  });

const envFor = (m: MissionIR, over: Partial<CompileEnv> = {}): CompileEnv =>
  baseEnv({ lines: new Set([...Object.keys(LINES), ...m.stages.flatMap((s) => s.objectives.map((o) => o.text)), m.title]), i18n: new Set(['mission.m.t.depict.title']), ...over });

const errorsOf = (m: MissionIR, over: Partial<CompileEnv> = {}) => compileMission(m, envFor(m, over)).errors;

describe('depiction lint: one fixture per rule (AC-2)', () => {
  it('the base mission, with a roster slot as an opponent in a lawful stage, is clean', () => {
    expect(errorsOf(mk())).toEqual([]);
  });

  it('a roster slot is the target of a chase: E_DEPICTION at the objective', () => {
    const m = mk({ stages: [stage('a', [chase('star', 3, { id: 'chase_star' })])] });
    const e = errorsOf(m);
    expect(e.map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/stages/0/objectives/0']);
  });

  it('a roster slot in an unlawful stage: E_DEPICTION at the stage', () => {
    const m = mk({ stages: [stage('a', [goto('z', { id: 'goto_z' })]), stage('b', [escape({ id: 'escape_b' })], { onEnter: [say('star', 'line.t.hello')] })] });
    const e = errorsOf(m);
    expect(e.some((x) => x.code === 'E_DEPICTION' && x.pointer.startsWith('/stages/1'))).toBe(true);
  });

  it('a weapon.* prefab: E_DEPICTION at the prefab', () => {
    const m = mk({ cast: { star: npc({ slot: 'RAP_NEW_WAVE', role: 'opponent', spawn: at(NEAR.b[0], NEAR.b[1]) }), gun: prop({ prefab: 'weapon.pistol', spawn: at(NEAR.c[0], NEAR.c[1]) }) } });
    const e = errorsOf(m);
    expect(e.map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/cast/gun/prefab']);
  });

  it('a defeat that is not non-lethal: E_DEPICTION at its nonLethal; the schema stops it first in a full compile', () => {
    const good = mk({ stages: [stage('a', [defeat(['pal'], { id: 'defeat_pal' })])], cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(NEAR.b[0], NEAR.b[1]) }) } });
    const lethal = JSON.parse(JSON.stringify(good)) as MissionIR;
    (lethal.stages[0]!.objectives[0] as { nonLethal: boolean }).nonLethal = false;
    expect(lintMission(lethal, envFor(lethal)).map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/stages/0/objectives/0/nonLethal']);
    expect(errorsOf(lethal).map((x) => x.code)).toContain('E_SCHEMA');
    expect(errorsOf(good)).toEqual([]);
  });

  it('a mission in D4 without the sensitivity-read tag: E_DEPICTION at /tags', () => {
    const m = mk({ district: 'd4' });
    expect(errorsOf(m).map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/tags']);
    expect(errorsOf(mk({ district: 'd4', tags: ['sensitivity-read'] }))).toEqual([]);
  });

  it('an athlete slot in a sports context: E_DEPICTION at the slot', () => {
    const m = mk({ tags: ['sports'], cast: { star: npc({ slot: 'ATH_POWER_BACK', role: 'cameo', spawn: at(NEAR.b[0], NEAR.b[1]) }) } });
    expect(errorsOf(m).map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/cast/star/who/slot']);
    const ok = mk({ cast: { star: npc({ slot: 'ATH_POWER_BACK', role: 'cameo', spawn: at(NEAR.b[0], NEAR.b[1]) }) } });
    expect(errorsOf(ok)).toEqual([]);
  });

  it('a real-derived slot in a sideshow mission, or with a hero role: E_DEPICTION', () => {
    expect(errorsOf(mk({ tags: ['sideshow'] })).map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/tags']);
    const hero = mk({ cast: { star: npc({ slot: 'RAP_NEW_WAVE', role: 'ally', spawn: at(NEAR.b[0], NEAR.b[1]) }) } });
    expect(errorsOf(hero).map((x) => [x.code, x.pointer])).toContainEqual(['E_DEPICTION', '/cast/star/role']);
  });

  it('a real-side name in a line: E_NAME at the line', () => {
    const m = mk({ stages: [stage('a', [goto('z', { id: 'goto_z' })], { onEnter: [say('star', 'line.t.hello')] })] });
    const e = errorsOf(m, { names: compileRealNames([{ id: 'zed', real: 'Zed Zeppelin' }]), lineText: { ...LINES, 'line.t.hello': 'Hello from Zed Zeppelin.' } });
    expect(e.map((x) => [x.code, x.pointer])).toContainEqual(['E_NAME', '/stages/0/onEnter/0/line']);
  });
});

describe('depiction lint on the Act 1 missions', () => {
  it('m.a1.03 (sideshow) and m.a1.05 (D4) carry their tags, and every Act 1 mission is compiled', () => {
    const load = (id: string): MissionIR => JSON.parse(readFileSync(path.join(root, 'assets/src/data', `mission.${id}`, 'mission.json'), 'utf8')) as MissionIR;
    expect(load('m.a1.01').tags).toContain('sensitivity-read');
    expect(load('m.a1.03').tags).toEqual(expect.arrayContaining(['sideshow', 'sensitivity-read']));
    expect(load('m.a1.05').tags).toContain('sensitivity-read');
    expect(load('m.a1.05').district).toBe('d4');
    // the roster slots of m.a1.04 and m.a1.05 are hosts, cameos and opponents, never targets of anything
    for (const id of ['m.a1.04', 'm.a1.05']) {
      const ir = load(id);
      for (const c of Object.values(ir.cast)) if (c.k === 'npc' && 'slot' in c.who) expect(['host', 'cameo', 'opponent']).toContain(c.role);
    }
  });
});
