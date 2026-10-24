import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { MissionIR } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { planBuild, stableJson } from '../../../../tools/ci/missions/build.ts';
import { chase, defineMission, goto, npc, stage, talk, talkDef, at, circle, setFlag, escape, heat } from '../src/authoring/index.ts';
import { compileMission, type CompileErrorCode } from '../src/compiler/index.ts';
import { baseEnv, baseMission, LINES, type Fixture } from './fixtures/base.ts';

const root = path.resolve(import.meta.dirname, '../../../..');

describe('compiler: the sample and the bad fixtures (AC-1)', () => {
  it('every mission of the repository compiles with zero errors, and the outputs are stable', async () => {
    const a = await planBuild({ root });
    expect(a.errors).toEqual([]);
    expect(a.problems).toEqual([]);
    expect(a.missions).toEqual(['m.a1.01', 'm.a1.02', 'm.a1.03', 'm.a1.04', 'm.a1.05', 'm.a1.06', 'm.dev.sample', 'm.dev.talk']);
    const b = await planBuild({ root });
    expect([...a.files]).toEqual([...b.files]);
  });

  const dir = path.join(import.meta.dirname, 'fixtures/bad');
  const codes = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)).sort();
  const expected: CompileErrorCode[] = [
    'E_BUDGET', 'E_DEPICTION', 'E_HOOK_STUB', 'E_NAME', 'E_NO_FALLBACK', 'E_OUT_OF_BOUNDS', 'E_REF_CAST', 'E_REF_LANDMARK', 'E_REF_LINE', 'E_REF_ZONE',
    'E_ROUTE_UNSNAPPABLE', 'E_SCHEMA', 'E_UNREACHABLE_STAGE',
  ];

  it('has one fixture per compiler code', () => {
    expect(codes).toEqual(expected);
  });

  it('the base mission is clean', () => {
    const r = compileMission(baseMission(), baseEnv());
    expect(r.errors).toEqual([]);
  });

  for (const code of expected) {
    it(`${code}: exactly that code, with a pointer to the node`, async () => {
      const f = ((await import(`./fixtures/bad/${code}.ts`)) as { default: Fixture }).default;
      expect(f.code).toBe(code);
      const r = compileMission(f.build(), f.env ? f.env() : baseEnv());
      expect(r.errors.length).toBeGreaterThan(0);
      expect([...new Set(r.errors.map((e) => e.code))]).toEqual([code]);
      expect(r.errors.map((e) => e.pointer)).toContain(f.pointer);
      for (const e of r.errors) expect(e.pointer.startsWith('/')).toBe(true);
    });
  }
});

describe('compiler: details', () => {
  it('defineMission makes ids unique, fills texts and ink knots, and lists the lines the ops speak', () => {
    const m = defineMission({
      id: 'm.t.auth',
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(37.7794, -122.4192) }) },
      zones: { z: circle(37.7794, -122.4192, 5) },
      stages: [
        stage('a', [goto('z'), goto('z')], { onEnter: [{ op: 'say', speaker: 'pal', line: 'line.t.hello' }] }),
        stage('b', [talk(talkDef({ id: 'chat', npc: 'pal', intent: 'k.intent', outcomes: { yes: { label: 'k.yes' } }, default: 'yes' }))]),
      ],
    });
    const ids = m.stages[0]!.objectives.map((o) => o.id);
    expect(ids).toEqual(['goto_z', 'goto_z_2']);
    expect(m.stages[0]!.objectives[0]!.text).toBe('mission.m.t.auth.obj.goto_z');
    const t = m.stages[1]!.objectives[0]!;
    expect(t.k === 'talk' && t.talk.ink).toBe('mission_m_t_auth_chat');
    expect(m.lines).toEqual(['line.t.hello']);
  });

  it('infers conduct and puts a despawn of the real-derived cast at the start of an unlawful stage', () => {
    const m = defineMission({
      id: 'm.t.real',
      version: 1,
      district: 'd1',
      cast: {
        star: npc({ soul: 'real_soul', role: 'mentor', spawn: at(37.7794, -122.4192) }),
        dude: npc({ soul: 'npc_test', role: 'rival', spawn: at(37.7794, -122.4192) }),
      },
      zones: { z: circle(37.7794, -122.4192, 5) },
      stages: [stage('calm', [goto('z')]), stage('hot', [escape()], { onEnter: [heat({ set: 2 })] })],
    });
    const env = baseEnv({ lines: new Set([...Object.keys(LINES), 'mission.m.t.real.title', 'mission.m.t.real.obj.goto_z', 'mission.m.t.real.obj.escape']) });
    const r = compileMission(m, env);
    expect(r.errors).toEqual([]);
    expect(r.ir.stages.map((s) => s.conduct)).toEqual(['lawful', 'unlawful']);
    expect(r.ir.stages[1]!.onEnter![0]).toEqual({ op: 'despawn', cast: ['star'] });
    expect(r.ir.stages[0]!.onEnter).toBeUndefined();
    expect(r.ir.worldBake).toBe('test-bake');
  });

  it('refuses a real-derived character as a target, in a bad role, and in an unlawful stage', () => {
    const mk = (extra: Partial<Parameters<typeof defineMission>[0]>): MissionIR =>
      defineMission({
        id: 'm.t.depict',
        version: 1,
        district: 'd1',
        cast: { star: npc({ soul: 'real_soul', role: 'mentor', spawn: at(37.7794, -122.4192) }) },
        zones: { z: circle(37.7794, -122.4192, 5) },
        stages: [stage('a', [goto('z')])],
        ...extra,
      });
    const env = (m: MissionIR) => baseEnv({ lines: new Set([...Object.keys(LINES), ...m.stages.flatMap((s) => s.objectives.map((o) => o.text)), m.title]), i18n: new Set(['mission.m.t.depict.title']) });
    const chased = mk({ stages: [stage('a', [chase('star', 3)])] });
    expect(compileMission(chased, env(chased)).errors.map((e) => e.code)).toContain('E_DEPICTION');
    const hero = mk({ cast: { star: npc({ soul: 'real_soul', role: 'ally', spawn: at(37.7794, -122.4192) }) } });
    expect(compileMission(hero, env(hero)).errors.map((e) => e.pointer)).toContain('/cast/star/role');
    const tagged = mk({ tags: ['sideshow'] });
    expect(compileMission(tagged, env(tagged)).errors.map((e) => e.pointer)).toContain('/tags');
    const unlawful = mk({ stages: [stage('a', [goto('z')]), stage('b', [escape()], { onEnter: [{ op: 'say', speaker: 'star', line: 'line.t.hello' }] })] });
    expect(compileMission(unlawful, env(unlawful)).errors.some((e) => e.code === 'E_DEPICTION' && e.pointer.startsWith('/stages/1'))).toBe(true);
  });

  it('missions in d3 and d4 need the sensitivity-read tag', () => {
    const m = { ...baseMission(), district: 'd4' as const };
    expect(compileMission(m, baseEnv()).errors.map((e) => e.pointer)).toContain('/tags');
    expect(compileMission({ ...m, tags: ['sensitivity-read'] }, baseEnv()).errors).toEqual([]);
  });

  it('the mod profile refuses rewards and give; a talk jump makes the target stage reachable', () => {
    const m = { ...baseMission(), act: 0 as const, premise: 'mod' as const, id: 'm.mod.pack.one' as const, rewards: { cashCents: 5 } };
    const r = compileMission(m, baseEnv({ profile: 'mod' }));
    expect(r.errors.map((e) => e.code)).toEqual(['E_SCHEMA']);
    const jump = defineMission({
      id: 'm.t.jump',
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(37.7794, -122.4192) }) },
      zones: { z: circle(37.7794, -122.4192, 5) },
      stages: [
        { ...stage('a', [talk(talkDef({ id: 't', npc: 'pal', intent: 'k.i', outcomes: { go: { label: 'k.go', stage: 'c' } }, default: 'go' }))], { next: 'b' }) },
        stage('b', [goto('z')], { next: 'b' }),
        stage('c', [goto('z', { id: 'goto_c' })], { onEnter: [setFlag({ 'x.y': true })] }),
      ],
    });
    const env = baseEnv({ lines: new Set([...Object.keys(LINES), 'k.i', 'k.go', 'mission.m.t.jump.title', ...jump.stages.flatMap((s) => s.objectives.map((o) => o.text))]) });
    const res = compileMission(jump, env);
    expect(res.errors.filter((e) => e.code === 'E_UNREACHABLE_STAGE')).toEqual([]);
  });

  it('stableJson sorts keys at every depth', () => {
    expect(stableJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: 0 } })).toBe('{\n  "a": {\n    "c": 0,\n    "d": [\n      {\n        "x": 2,\n        "y": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
  });

  it('audio needs name the speaker of each spoken line', () => {
    const r = compileMission(baseMission(), baseEnv());
    expect(r.audioNeeds).toEqual([{ line: 'line.t.hello', speaker: 'npc_test' }]);
  });
});
