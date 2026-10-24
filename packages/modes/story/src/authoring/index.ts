import type { LineId, MissionIR, ObjectiveDef, Op, StageDef, TalkDef } from '@dv/shared';
import type { DraftObjective, MissionInput } from './helpers.ts';

export * from './helpers.ts';
export * from './director.ts';

const knotOf = (missionId: string, talkId: string): string => `mission_${missionId}_${talkId}`.replace(/[.-]/g, '_');

/** Every `LineId` an op tree speaks or texts, in first-seen order. */
export function linesOfOps(ops: readonly Op[] | undefined, into: LineId[] = []): LineId[] {
  for (const o of ops ?? []) {
    switch (o.op) {
      case 'say':
      case 'text':
        if (!into.includes(o.line)) into.push(o.line);
        break;
      case 'seq':
        linesOfOps(o.body, into);
        break;
      case 'all':
      case 'race':
        for (const b of o.branches) linesOfOps(b, into);
        break;
      case 'if':
        linesOfOps(o.then, into);
        linesOfOps(o.else, into);
        break;
      case 'loop':
        linesOfOps(o.body, into);
        break;
      case 'waitUntil':
        linesOfOps(o.onTimeout, into);
        break;
      default:
        break;
    }
  }
  return into;
}

/**
 * Builds a `MissionIR` from authoring input. The result is data only. Objective ids are made unique inside the mission, objectives
 * without a text get `mission.<id>.obj.<objectiveId>`, talks without an ink knot get `mission_<id>_<talkId>`, and `lines` lists every
 * line the ops speak (plus any the author added). The world bake is left empty: the compiler writes it.
 */
export function defineMission(input: MissionInput): MissionIR {
  const id = input.id;
  const used = new Map<string, number>();
  const unique = (raw: string): string => {
    const n = (used.get(raw) ?? 0) + 1;
    used.set(raw, n);
    return n === 1 ? raw : `${raw}_${n}`;
  };
  const finish = (o: DraftObjective): ObjectiveDef => {
    const oid = unique(o.id ?? o.k);
    const out = { ...o, id: oid, text: o.text && o.text !== '' ? o.text : `mission.${id}.obj.${oid}` } as ObjectiveDef;
    if (out.k === 'talk') {
      const t: TalkDef = { ...out.talk, ink: out.talk.ink === '' ? knotOf(id, out.talk.id) : out.talk.ink };
      return { ...out, talk: t };
    }
    return out;
  };
  const stages: StageDef[] = input.stages.map((s) => {
    const { objectives, ...rest } = s;
    return { ...rest, objectives: objectives.map(finish) };
  });
  const modeHooks = input.modeHooks?.map((h) => ({ ...h, stub: finish(h.stub as unknown as DraftObjective) }));
  const lines: LineId[] = [...(input.lines ?? [])];
  for (const s of stages) {
    linesOfOps(s.onEnter, lines);
    linesOfOps(s.onComplete, lines);
  }
  for (const ops of Object.values(input.threads ?? {})) linesOfOps(ops, lines);
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const uniqueLines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
  const ir: MissionIR = {
    schema: 'mission-ir/1',
    id,
    version: input.version,
    worldBake: input.worldBake ?? '',
    act: input.act ?? 1,
    premise: input.premise ?? 'hella-valuation',
    title: input.title ?? `mission.${id}.title`,
    district: input.district,
    tags: input.tags ?? [],
    giver: input.giver ?? { world: true },
    requires: input.requires ?? [],
    start: input.start ?? { k: 'auto', when: { p: 'true' } },
    cast: input.cast,
    zones: input.zones,
    stages,
    fail: input.fail ?? [],
    heatPolicy: input.heatPolicy ?? { maxHeat: 0, clearOnPass: true },
    rewards: input.rewards ?? {},
    autoplay: input.autoplay ?? { expectedSec: [30, 600], seeds: [1, 2, 3] },
    lines: uniqueLines,
    ...(input.intro ? { intro: input.intro } : {}),
    ...(input.outro ? { outro: input.outro } : {}),
    ...(input.threads ? { threads: input.threads } : {}),
    ...(input.ambient ? { ambient: input.ambient } : {}),
    ...(input.medals ? { medals: input.medals } : {}),
    ...(input.unlocks ? { unlocks: input.unlocks } : {}),
    ...(modeHooks ? { modeHooks } : {}),
  };
  return ir;
}
