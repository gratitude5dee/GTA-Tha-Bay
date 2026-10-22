/**
 * Content and depiction lint (C09 section C11, R-IP-02), run by `missions:build`:
 *  1. real-derived cast: allowed roles, lawful stages only, never a target, never in sideshow or jailbreak missions, talk outcomes
 *     never lead to an unlawful stage;
 *  2. no firearms: prefab and item ids under `weapon.` are rejected (`defeat` is non-lethal by the schema);
 *  3. names: the text of every referenced line and key passes the real-name matchers and the ip-denylist strings;
 *  4. missions in districts d3 and d4 carry the tag `sensitivity-read`.
 */
import { scanText, type MissionIR, type Op, type StageDef } from '@dv/shared';
import type { CompileEnv, CompileError } from './types.ts';
import { walkMission, walkOps, type Visitor } from './walk.ts';

const REAL_ROLES = new Set(['mentor', 'rival', 'host', 'opponent', 'cameo']);
const SENSITIVE = new Set(['d3', 'd4']);

/** The cast names that stand for real people. */
export function realDerivedCast(ir: MissionIR, env: CompileEnv): string[] {
  const out: string[] = [];
  for (const [name, c] of Object.entries(ir.cast)) {
    if (c.k !== 'npc') continue;
    const real = 'slot' in c.who ? true : (env.realDerived?.(c.who) ?? false);
    if (real) out.push(name);
  }
  return out;
}

const hasHeatOp = (ops: readonly Op[] | undefined): boolean => {
  let found = false;
  walkOps({ op: (o) => { if (o.op === 'heat' && o.set !== undefined && o.set > 0) found = true; } }, ops, '');
  return found;
};

/** `conduct` of a stage: the author's value, else `unlawful` when it has an escape or stealth objective or sets heat. */
export function conductOf(s: StageDef): 'lawful' | 'unlawful' {
  if (s.conduct) return s.conduct;
  if (s.objectives.some((o) => o.k === 'escape' || o.k === 'stealth')) return 'unlawful';
  return hasHeatOp(s.onEnter) || hasHeatOp(s.onComplete) ? 'unlawful' : 'lawful';
}

export function lintMission(ir: MissionIR, env: CompileEnv): CompileError[] {
  const errors: CompileError[] = [];
  const add = (code: CompileError['code'], pointer: string, message: string): void => void errors.push({ code, pointer, message });
  const real = new Set(realDerivedCast(ir, env));

  // 1. real-derived cast
  for (const name of real) {
    const c = ir.cast[name];
    if (c?.k === 'npc' && !REAL_ROLES.has(c.role)) add('E_DEPICTION', `/cast/${name}/role`, `a real-derived character may only be mentor, rival, host, opponent or cameo, not ${c.role}`);
  }
  if (real.size > 0 && ir.tags.some((t) => t === 'sideshow' || t === 'jailbreak')) add('E_DEPICTION', '/tags', 'a real-derived character never appears in a sideshow or jailbreak mission');
  const targetKinds = new Set(['chase', 'follow', 'defeat']);
  walkMission(
    {
      objective(o, ptr) {
        const targets = o.k === 'chase' || o.k === 'follow' ? [o.target] : o.k === 'defeat' ? o.targets : [];
        if (!targetKinds.has(o.k)) return;
        for (const t of targets) if (real.has(t)) add('E_DEPICTION', ptr, `a real-derived character (${t}) is never the target of ${o.k}`);
      },
    },
    ir,
  );
  const unlawfulIds = new Set(ir.stages.filter((s) => conductOf(s) === 'unlawful').map((s) => s.id));
  ir.stages.forEach((s, si) => {
    const p = `/stages/${si}`;
    if (unlawfulIds.has(s.id)) {
      const hit: Visitor = {
        cast: (name, ptr) => {
          if (real.has(name)) add('E_DEPICTION', ptr, `a real-derived character (${name}) may not appear in the unlawful stage ${s.id}`);
        },
      };
      // the despawn that the compiler puts at the start of the stage is not a reference; only the author's ops and objectives are
      walkOps(hit, s.onComplete, `${p}/onComplete`);
      walkOps(hit, s.onEnter, `${p}/onEnter`);
      s.objectives.forEach((o, oi) => {
        const refs: string[] = [];
        if (o.k === 'follow' || o.k === 'chase' || o.k === 'protect') refs.push(o.target);
        if (o.k === 'collect' || o.k === 'deliver') refs.push(o.cast);
        if (o.k === 'defeat') refs.push(...o.targets);
        if (o.k === 'talk') refs.push(o.talk.npc);
        for (const r of refs) if (real.has(r)) add('E_DEPICTION', `${p}/objectives/${oi}`, `a real-derived character (${r}) may not appear in the unlawful stage ${s.id}`);
      });
    }
    for (const [oi, o] of s.objectives.entries()) {
      if (o.k !== 'talk' || !real.has(o.talk.npc)) continue;
      for (const [name, out] of Object.entries(o.talk.outcomes)) {
        if (out.stage !== undefined && unlawfulIds.has(out.stage)) add('E_DEPICTION', `${p}/objectives/${oi}/talk/outcomes/${name}/stage`, 'a talk with a real-derived character never leads to an unlawful stage');
      }
    }
  });

  // 2. no firearms
  const weapon = (id: string, ptr: string): void => {
    if (id.startsWith('weapon.')) add('E_DEPICTION', ptr, `${id}: weapons are not part of this game`);
  };
  walkMission({ prefab: weapon, item: weapon }, ir);
  (ir.rewards.items ?? []).forEach((it, i) => weapon(it.id, `/rewards/items/${i}/id`));
  (ir.rewards.vehicles ?? []).forEach((id, i) => weapon(id, `/rewards/vehicles/${i}`));

  // 3. names
  if (env.lineText) {
    const first = new Map<string, string>();
    const note = (key: string, ptr: string): void => void (first.has(key) ? undefined : first.set(key, ptr));
    walkMission({ line: note, loc: note }, ir);
    for (const [key, ptr] of first) {
      const text = env.lineText[key];
      if (text === undefined) continue;
      for (const m of env.names ?? []) if (m.re.test(text)) add('E_NAME', ptr, `${key}: a real-side name (${m.id}) appears in the text`);
      if (env.strings) for (const h of scanText(text, env.strings)) add('E_NAME', ptr, `${key}: "${h.match}" is on the ip denylist (${h.rule})`);
    }
  }

  // 4. sensitive districts
  if (SENSITIVE.has(ir.district) && !ir.tags.includes('sensitivity-read')) add('E_DEPICTION', '/tags', `a mission in ${ir.district} needs the tag sensitivity-read`);
  return errors;
}
