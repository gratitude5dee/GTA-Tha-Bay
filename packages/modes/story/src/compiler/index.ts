import type { MissionIR, Op } from '@dv/shared';
import { conductOf, lintMission, realDerivedCast } from './lint.ts';
import type { CompileEnv, CompileError, CompileResult } from './types.ts';
import { validateRefs, validateSchema } from './validate.ts';
import { walkMission } from './walk.ts';

export * from './types.ts';
export { validateSchema, validateRefs, reachableStages, OP_NODE_LIMIT } from './validate.ts';
export { lintMission, conductOf, realDerivedCast } from './lint.ts';
export { walkMission, walkOps, walkPred } from './walk.ts';
export { checkSensitivity, validateSensitivityFile, SENSITIVITY_TAG } from './sensitivity.ts';
export type { SensitivityRow, SensitivityFile, SensitivityFinding, SensitivityResult } from './sensitivity.ts';
export type { Visitor } from './walk.ts';

const byPointer = (a: CompileError, b: CompileError): number => (a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/** The speakers of the lines the mission speaks, for `content/audio-needs/story.json`. */
function audioNeeds(ir: MissionIR): { line: string; speaker: string }[] {
  const out = new Map<string, string>();
  const soulOf = (cast: string): string => {
    const c = ir.cast[cast];
    if (c?.k === 'npc') return 'soul' in c.who ? c.who.soul : `slot:${c.who.slot}`;
    return cast;
  };
  walkMission(
    {
      op(o) {
        if (o.op === 'say' && !out.has(o.line)) out.set(o.line, o.speaker === 'player' || o.speaker === 'radio' ? o.speaker : soulOf(o.speaker));
        if (o.op === 'text' && !out.has(o.line)) out.set(o.line, o.from);
      },
    },
    ir,
  );
  return [...out].map(([line, speaker]) => ({ line, speaker })).sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0));
}

/**
 * Compiles one authored mission (C09 section C5, step 1): schema, then references and bounds, then the content lint. On success the
 * returned IR has the world bake written, every stage's `conduct` set, and a `despawn` of the real-derived cast at the start of each
 * unlawful stage. Errors carry a JSON Pointer; a schema error stops the later stages, because they walk the tree.
 */
export function compileMission(input: MissionIR, env: CompileEnv): CompileResult {
  const ir: MissionIR = { ...input, worldBake: env.worldBake };
  const schema = validateSchema(ir, env.profile);
  if (schema.length > 0) return { ir, errors: schema, audioNeeds: [] };
  const errors = [...validateRefs(ir, env), ...lintMission(ir, env)].sort(byPointer);
  if (errors.length > 0) return { ir, errors, audioNeeds: audioNeeds(ir) };
  const real = realDerivedCast(ir, env);
  const stages = ir.stages.map((s) => {
    const conduct = conductOf(s);
    const despawn: Op[] = conduct === 'unlawful' && real.length > 0 ? [{ op: 'despawn', cast: real }] : [];
    return { ...s, conduct, ...(despawn.length > 0 ? { onEnter: [...despawn, ...(s.onEnter ?? [])] } : {}) };
  });
  const out: MissionIR = { ...ir, stages };
  return { ir: out, errors: [], audioNeeds: audioNeeds(out) };
}
