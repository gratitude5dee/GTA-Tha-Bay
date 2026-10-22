import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { missionIrSchema } from '../scripts/mission-ir-schema.ts';

const here = import.meta.dirname;
const schemaText = readFileSync(path.join(here, '../schemas/mission-ir-1.schema.json'), 'utf8');
const schema = JSON.parse(schemaText) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
ajv.addSchema(schema);
const story = ajv.getSchema('mission-ir-1#/$defs/story');
const mod = ajv.getSchema('mission-ir-1#/$defs/mod');
if (!story || !mod) throw new Error('profile roots missing');

const line = (n: string): string => `line.test.${n}`;
const goodMission = (): Record<string, unknown> => ({
  schema: 'mission-ir/1', id: 'm.dev.test', version: 1, worldBake: 'graybox', act: 0, premise: 'hella-valuation', title: 'mission.m.dev.test.title', district: 'd4', tags: ['dev'],
  giver: { world: true }, requires: [], start: { k: 'marker', at: { at: [37.7793, -122.4193], snap: 'ground' }, radiusM: 8 },
  cast: { fare: { k: 'npc', who: { soul: 'ama_osei' }, role: 'civilian', spawn: { at: [37.7794, -122.4192], snap: 'ground' } } },
  zones: { a: { k: 'circle', at: [37.7795, -122.419], r: 10 } },
  stages: [{ id: 's0', join: 'all', objectives: [{ k: 'goto', id: 'o0', text: 'obj.goto.a', zone: 'a' }], onEnter: [{ op: 'say', speaker: 'fare', line: line('a') }] }],
  fail: [{ when: { p: 'ko', who: 'player' }, reason: 'fail.reason.ko', retry: 'checkpoint' }],
  heatPolicy: { maxHeat: 0, clearOnPass: true }, rewards: { cashCents: 5000 },
  autoplay: { expectedSec: [10, 100], seeds: [1, 2, 3] }, lines: [line('a')],
});

describe('mission-ir-1.schema.json', () => {
  it('is the output of the builder (pnpm --filter @dv/shared schema:mission)', () => {
    expect(schemaText).toBe(`${JSON.stringify(missionIrSchema(), null, 2)}\n`);
  });

  it('accepts a valid mission under both profiles where the profile allows it', () => {
    expect(story(goodMission())).toBe(true);
    const m = goodMission();
    m['act'] = 0;
    m['premise'] = 'mod';
    m['id'] = 'm.mod.pack.one';
    m['rewards'] = {};
    expect(mod(m), JSON.stringify(mod.errors)).toBe(true);
  });

  const hostile: [string, (m: Record<string, unknown>) => void, string][] = [
    ['33 cast entries', (m) => { m['cast'] = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`c${i}`, { k: 'prop', prefab: 'prop.box', spawn: { at: [37.7793, -122.4193], snap: 'ground' } }])); }, '/cast'],
    ['loop.max 10,001', (m) => { (m['stages'] as { onEnter: unknown[] }[])[0]!.onEnter = [{ op: 'loop', max: 10_001, body: [{ op: 'wait', sec: 1 }] }]; }, 'max'],
    ['wait.sec 601', (m) => { (m['stages'] as { onEnter: unknown[] }[])[0]!.onEnter = [{ op: 'wait', sec: 601 }]; }, 'sec'],
    ['a raw display string in title', (m) => { m['title'] = 'Pick up the fare'; }, '/title'],
    ['a raw display string in an objective text', (m) => { (m['stages'] as { objectives: { text: string }[] }[])[0]!.objectives[0]!.text = 'Go to the corner!'; }, 'text'],
    ['an unknown property', (m) => { m['extra'] = 1; }, 'extra'],
    ['17 stages', (m) => { m['stages'] = Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, join: 'all', objectives: [{ k: 'wait', id: 'w', text: 'obj.wait', sec: 1 }] })); }, '/stages'],
    ['a circle zone of 2,001 m', (m) => { m['zones'] = { a: { k: 'circle', at: [37.7795, -122.419], r: 2001 } }; }, 'r'],
    ['talk.maxTurns 13', (m) => { (m['stages'] as { objectives: unknown[] }[])[0]!.objectives = [{ k: 'talk', id: 't', text: 'obj.talk', talk: { id: 'x', npc: 'fare', intent: 'talk.x', outcomes: { a: { label: 'talk.a' } }, default: 'a', maxTurns: 13, ink: 'mission_m_dev_test_x' } }]; }, 'maxTurns'],
  ];
  for (const [name, mutate, hint] of hostile) {
    it(`rejects ${name}`, () => {
      const m = goodMission();
      mutate(m);
      expect(story(m)).toBe(false);
      expect(JSON.stringify(story.errors)).toContain(hint);
    });
  }

  it('rejects give, rewards, unlocks, mode hooks and story-key flags under the mod profile only', () => {
    const base = (): Record<string, unknown> => {
      const m = goodMission();
      m['act'] = 0;
      m['premise'] = 'mod';
      m['id'] = 'm.mod.pack.one';
      m['rewards'] = {};
      return m;
    };
    const withOp = (op: unknown): Record<string, unknown> => {
      const m = base();
      (m['stages'] as { onEnter: unknown[] }[])[0]!.onEnter = [op];
      return m;
    };
    const give = { op: 'give', cashCents: 100, idem: 'g1' };
    expect(mod(withOp(give))).toBe(false);
    expect(story({ ...goodMission(), stages: (withOp(give)['stages']) })).toBe(true);
    expect(mod(withOp({ op: 'flag', set: { 'story.act': 2 } }))).toBe(false);
    expect(mod(withOp({ op: 'flag', set: { 'mod.step': 2 } }))).toBe(true);
    expect(mod({ ...base(), rewards: { cashCents: 1 } })).toBe(false);
    expect(mod({ ...base(), unlocks: ['unlock.racing'] })).toBe(false);
    expect(mod({ ...base(), modeHooks: [] })).toBe(false);
    expect(mod(withOp({ op: 'beat', ref: { cutscene: 'cut.story.x' } }))).toBe(false);
    expect(mod(withOp({ op: 'beat', ref: { director: 'dir.x' } }))).toBe(true);
    expect(mod({ ...base(), act: 1 })).toBe(false);
  });
});

// ---- drift: the schema's property sets equal the TypeScript types -------------------------------------------------------------

interface Shape { tag: string; props: Map<string, ts.TypeNode | undefined> }

const source = ts.createSourceFile('c09-mission.ts', readFileSync(path.join(here, '../src/contracts/c09-mission.ts'), 'utf8'), ts.ScriptTarget.ES2022, true);
const decls = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>();
for (const st of source.statements) {
  if (ts.isTypeAliasDeclaration(st)) decls.set(st.name.text, st.type);
  else if (ts.isInterfaceDeclaration(st)) decls.set(st.name.text, st);
}

const strip = (n: ts.TypeNode): ts.TypeNode => (ts.isParenthesizedTypeNode(n) ? strip(n.type) : n);
const literalValues = (n: ts.TypeNode | undefined): string[] | null => {
  if (!n) return null;
  const t = strip(n);
  if (ts.isLiteralTypeNode(t) && (ts.isStringLiteral(t.literal) || t.literal.kind === ts.SyntaxKind.NumericLiteral)) return [t.literal.getText().replace(/['"]/g, '')];
  if (ts.isUnionTypeNode(t)) {
    const parts = t.types.map((x) => literalValues(x));
    return parts.every((p) => p !== null) ? parts.flatMap((p) => p as string[]) : null;
  }
  return null;
};
function membersOf(members: readonly ts.TypeElement[]): Map<string, ts.TypeNode | undefined> {
  const out = new Map<string, ts.TypeNode | undefined>();
  for (const m of members) if (ts.isPropertySignature(m) && m.name) out.set(m.name.getText(), m.type);
  return out;
}
/** Every object shape a type expression can take: a union fans out, an intersection multiplies. */
function shapes(n: ts.TypeNode | ts.InterfaceDeclaration): Map<string, ts.TypeNode | undefined>[] {
  if (ts.isInterfaceDeclaration(n)) return [membersOf(n.members)];
  const t = strip(n);
  if (ts.isTypeLiteralNode(t)) return [membersOf(t.members)];
  if (ts.isUnionTypeNode(t)) return t.types.flatMap((x) => shapes(x));
  if (ts.isIntersectionTypeNode(t)) {
    return t.types.map((x) => shapes(x)).reduce<Map<string, ts.TypeNode | undefined>[]>(
      (acc, list) => acc.flatMap((a) => list.map((b) => new Map([...a, ...b]))),
      [new Map()],
    );
  }
  return [];
}
function tsShapes(name: string, tagKey: string | null): Shape[] {
  const decl = decls.get(name);
  if (!decl) throw new Error(`no type ${name}`);
  return shapes(decl).map((props) => ({ tag: tagKey ? (literalValues(props.get(tagKey))?.join('|') ?? '?') : '*', props }));
}

type J = Record<string, unknown>;
const defs = (schema['$defs'] as Record<string, J>);
const resolve = (n: J): J => (typeof n['$ref'] === 'string' ? (defs[(n['$ref'] as string).slice(8)] as J) : n);
function schemaShapes(node: J, tagKey: string | null): { tag: string; props: Map<string, J> }[] {
  const n = resolve(node);
  const branches = (n['oneOf'] ?? n['anyOf']) as J[] | undefined;
  const list = branches ? branches.map(resolve) : [n];
  return list
    .filter((b) => b['type'] === 'object')
    .map((b) => {
      const props = new Map(Object.entries((b['properties'] ?? {}) as Record<string, J>));
      const t = tagKey ? props.get(tagKey) : undefined;
      const tag = tagKey ? (t && 'const' in t ? String(t['const']) : t && Array.isArray(t['enum']) ? (t['enum'] as unknown[]).join('|') : '?') : '*';
      return { tag, props };
    });
}

function compare(path0: string, ts0: Shape[], sc: { tag: string; props: Map<string, J> }[]): void {
  const tsByTag = new Map(ts0.map((s) => [s.tag, s]));
  expect(sc.map((s) => s.tag).sort(), `${path0}: tags`).toEqual([...tsByTag.keys()].sort());
  for (const s of sc) {
    const t = tsByTag.get(s.tag) as Shape;
    expect([...s.props.keys()].sort(), `${path0}[${s.tag}]: properties`).toEqual([...t.props.keys()].sort());
    for (const [k, child] of s.props) {
      const tn = t.props.get(k);
      const inner = tn ? strip(tn) : undefined;
      const sub = resolve(child);
      if (inner && ts.isTypeLiteralNode(inner) && sub['properties']) compare(`${path0}[${s.tag}].${k}`, [{ tag: '*', props: membersOf(inner.members) }], schemaShapes(sub, null));
    }
  }
}

describe('mission-ir-1.schema.json against c09-mission.ts', () => {
  const rootShape = (): { tag: string; props: Map<string, J> }[] => schemaShapes(defs['story'] as J, null);
  const cases: [string, string | null, () => { tag: string; props: Map<string, J> }[]][] = [
    ['MissionIR', null, rootShape],
    ['Trigger', 'k', () => schemaShapes(defs['Trigger'] as J, 'k')],
    ['Placement', null, () => schemaShapes(defs['Placement'] as J, null)],
    ['CastDef', 'k', () => schemaShapes(defs['CastDef'] as J, 'k')],
    ['ZoneDef', 'k', () => schemaShapes(defs['ZoneDef'] as J, 'k')],
    ['StageDef', null, () => schemaShapes(defs['StageDef'] as J, null)],
    ['ObjectiveDef', 'k', () => schemaShapes(defs['ObjectiveDef'] as J, 'k')],
    ['TalkDef', null, () => schemaShapes(defs['TalkDef'] as J, null)],
    ['ModeHook', null, () => schemaShapes(defs['ModeHook'] as J, null)],
    ['FailRule', null, () => schemaShapes(defs['FailRule'] as J, null)],
    ['Rewards', null, () => schemaShapes(defs['Rewards'] as J, null)],
    ['Op', 'op', () => schemaShapes(defs['Op'] as J, 'op')],
    ['NpcTask', 't', () => schemaShapes(defs['NpcTask'] as J, 't')],
    ['Pred', 'p', () => schemaShapes(defs['Pred'] as J, 'p')],
  ];
  for (const [name, tag, sc] of cases) {
    it(`${name} has the same property sets`, () => {
      compare(name, tsShapes(name, tag), sc());
    });
  }

  it('the TalkDef outcome entry and the unlock gate have the same property sets', () => {
    const talk = defs['TalkDef'] as J;
    const outcomes = ((talk['properties'] as Record<string, J>)['outcomes'] as J)['additionalProperties'] as J;
    const tsTalk = decls.get('TalkDef') as ts.InterfaceDeclaration;
    const outcomesType = strip(tsTalk.members.map((m) => (ts.isPropertySignature(m) && m.name.getText() === 'outcomes' ? m.type : undefined)).find(Boolean) as ts.TypeNode);
    // Record<string, { ... }>
    const entry = strip((outcomesType as ts.TypeReferenceNode).typeArguments![1]!);
    compare('TalkDef.outcomes[]', [{ tag: '*', props: membersOf((entry as ts.TypeLiteralNode).members) }], schemaShapes(outcomes, null));
    compare('TalkUnlock', tsShapes('TalkUnlock', null), schemaShapes((outcomes['properties'] as Record<string, J>)['when'] as J, null));
  });
});
