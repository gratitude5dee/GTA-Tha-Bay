/**
 * The race validator (M07a1, M07a2; 06-racing-data.md 4.2.1): rules V1 to V15. V12 (the par bot) checks here that the par and its hash
 * are present; `pnpm map:races par -- --check` re-runs the bot and reproduces them (M07a2).
 *
 * Rules that need the road graph (V1, V2, V7, V9 water) run when a bake is open and are skipped otherwise; the rest read only
 * the source and `race.json` and run everywhere (the fallback of the milestone's risk list, BD-M07a1-05). `source` rules (V10,
 * V11, V14, V15) never need a bake.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  centreline, isLandmarkPoint, type RaceDef, type RaceSource, type RaceValidationReport, type VehicleClass,
} from '../../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { loadContentWorld } from '../content.ts';
import type { BakeGraph } from './snap.ts';

type Finding = RaceValidationReport['findings'][number];

const SCHEMA_DIR = path.join(toolsRoot, 'packages', 'shared', 'schemas', 'racing');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = new Map<string, ReturnType<Ajv2020['compile']>>();
function schema(name: 'race-source' | 'race-def'): ReturnType<Ajv2020['compile']> {
  let v = validators.get(name);
  if (!v) {
    v = ajv.compile(JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8')) as object);
    validators.set(name, v);
  }
  return v;
}

/** Schema errors of a source or a compiled def, as `V0` findings (V0 = the file is not a race at all). */
export function schemaFindings(kind: 'race-source' | 'race-def', data: unknown): Finding[] {
  const v = schema(kind);
  if (v(data)) return [];
  return (v.errors ?? []).map((e) => ({ rule: 'V0' as `V${number}`, level: 'error' as const, message: `${kind} ${e.instancePath || '/'} ${e.message ?? 'invalid'}` }));
}

export const MAX_JSON_BYTES = 64 * 1024;

const LENGTH_RANGE_M: Record<string, [number, number]> = {
  sprint: [1200, 12000], circuit: [1000, 4000], hillclimb: [600, 3000],
  checkpoint: [500, 8000], speedtrap: [500, 8000], downhill: [500, 8000], drift: [500, 8000], pursuit: [500, 8000], sideshow: [500, 8000], robotaxiRush: [500, 8000],
};

const err = (rule: number, message: string, s?: number): Finding => ({ rule: `V${rule}`, level: 'error', message, ...(s !== undefined ? { s } : {}) });

export interface ValidateInput {
  source: RaceSource;
  /** The compiled def (null before the first compile). */
  def: RaceDef | null;
  /** The exact bytes of `race.json`, for V13. */
  json?: string;
  /** An open bake, for the graph rules. */
  bg?: BakeGraph | null;
}

export function validateRace(inp: ValidateInput): RaceValidationReport {
  const { source, def, bg } = inp;
  const f: Finding[] = [];

  // V10: every landmark id exists
  const landmarks = new Set(loadContentWorld().landmarks.map((l) => l.id));
  const pts = [...source.waypoints, ...(source.via ?? []), ...(source.gateOverrides ?? []).map((g) => g.at), ...(source.closures ?? []).map((c) => c.at), ...(source.zones ?? []).flatMap((z) => z.ring)];
  for (const p of pts) if (isLandmarkPoint(p) && !landmarks.has(p.landmark)) f.push(err(10, `landmark ${p.landmark} does not exist`));

  // V11: hour and weather
  if (source.hour !== undefined && !(source.hour >= 0 && source.hour < 24)) f.push(err(11, `hour ${source.hour} is outside 0 to 24`));
  if (source.weather !== undefined && !['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'].includes(source.weather)) f.push(err(11, `weather ${source.weather} is not a preset`));

  // V14: pursuit kinds are policed
  if ((source.kind === 'pursuit') && !(source.police.enabled && source.police.startHeat >= 1)) f.push(err(14, 'a pursuit needs police.enabled and startHeat >= 1'));

  // V15: opponents' vehicles are legal for classLimit
  if (source.classLimit && source.classLimit.length > 0) {
    for (const o of source.opponents) {
      const cls = classOfVehicle(o.vehicleDef);
      if (cls && !source.classLimit.includes(cls)) f.push(err(15, `opponent ${o.driverId} drives ${o.vehicleDef} (class ${cls}), outside the class limit ${source.classLimit.join('/')}`));
    }
  }
  if (source.opponents.length > 7) f.push(err(15, `${source.opponents.length} opponents, at most 7`));

  const stats = { lengthM: 0, maxGradePct: 0, gates: 0, jumps: 0 };
  if (def) {
    stats.lengthM = def.routeLenM;
    stats.gates = def.gates.length;
    stats.jumps = def.jumpZones.length;
    let maxGrade = 0;

    // V3: length by kind
    const [lo, hi] = LENGTH_RANGE_M[def.kind] ?? [500, 8000];
    if (def.routeLenM < lo || def.routeLenM > hi) f.push(err(3, `route length ${def.routeLenM.toFixed(0)} m is outside ${lo} to ${hi} m for a ${def.kind}`));

    // V4: grade (25 m samples)
    for (let i = 1; i < def.elevation.length; i++) {
      const a = def.elevation[i - 1] as { s: number; y: number };
      const b = def.elevation[i] as { s: number; y: number };
      const g = (Math.abs(b.y - a.y) / Math.max(1, b.s - a.s)) * 100;
      if (g > maxGrade) maxGrade = g;
      if (g > 41) f.push(err(4, `grade ${g.toFixed(1)} % is over 41 %`, a.s));
    }
    stats.maxGradePct = Math.round(maxGrade * 10) / 10;

    // V5: a circuit closes within 15 m and 25 degrees (the first and the last point of the racing line; the start gate sits behind the
    // grid, so the gates of a 3-car grid are further apart than the loop is open)
    if (def.kind === 'circuit') {
      const cl = centreline(def);
      const n = cl.length / 2;
      if (n >= 3) {
        const x0 = cl[0] as number, z0 = cl[1] as number;
        const x1 = cl[2 * n - 2] as number, z1 = cl[2 * n - 1] as number;
        const d = Math.hypot(x1 - x0, z1 - z0);
        const h0 = Math.atan2((cl[3] as number) - z0, (cl[2] as number) - x0);
        const h1 = Math.atan2(z1 - (cl[2 * n - 3] as number), x1 - (cl[2 * n - 4] as number));
        let dh = Math.abs(h1 - h0);
        if (dh > Math.PI) dh = 2 * Math.PI - dh;
        const deg = (dh * 180) / Math.PI;
        if (d > 15 || deg > 25) f.push(err(5, `the circuit ends ${d.toFixed(1)} m and ${deg.toFixed(0)} degrees off its start (limits 15 m, 25 degrees)`));
      }
    }

    // V6: gate spacing, width, none inside a closure
    for (let i = 1; i < def.gates.length; i++) {
      const a = def.gates[i - 1] as RaceDef['gates'][number];
      const b = def.gates[i] as RaceDef['gates'][number];
      if (b.s - a.s > 260) f.push(err(6, `gates ${i - 1} and ${i} are ${(b.s - a.s).toFixed(0)} m apart (limit 260)`, a.s));
    }
    def.gates.forEach((g, i) => {
      if (g.widthM < 10) f.push(err(6, `gate ${i} is ${g.widthM} m wide (minimum 10)`, g.s));
      for (const c of def.closures) if (Math.abs(c.s - g.s) < g.widthM / 2) f.push(err(6, `gate ${i} lies inside a closure`, g.s));
    });

    // V8: the grid fits the lanes (6 m spacing, 3.2 m lanes, at most 2 lanes abreast in a staggered grid)
    for (let i = 1; i < def.grid.length; i++) {
      const a = def.grid[i - 1] as RaceDef['grid'][number];
      const b = def.grid[i] as RaceDef['grid'][number];
      if (Math.abs(a.s - b.s) < 6 - 1e-6) f.push(err(8, `grid slots ${i - 1} and ${i} are ${Math.abs(a.s - b.s).toFixed(1)} m apart (minimum 6)`));
    }
    for (const g of def.grid) {
      if (g.s < 0) f.push(err(8, `a grid slot lies before the start of the route (s ${g.s})`));
      if (Math.abs(g.offsetM) + 3.2 * g.lane > 6.4) f.push(err(8, `a grid slot leaves the carriageway (lane ${g.lane}, offset ${g.offsetM})`));
    }
    if (def.grid.length < 1 + def.opponents.length) f.push(err(8, `${def.grid.length} grid slots for ${1 + def.opponents.length} cars`));

    // V9: every centreline point inside the play box
    const bounds = JSON.parse(readFileSync(path.join(toolsRoot, 'config', 'world.bounds.json'), 'utf8')) as { play: { minX: number; maxX: number; minZ: number; maxZ: number } };
    let x = def.line.start[0];
    let z = def.line.start[1];
    let out = false;
    const chk = (px: number, pz: number): void => {
      if (px < bounds.play.minX || px > bounds.play.maxX || pz < bounds.play.minZ || pz > bounds.play.maxZ) out = true;
    };
    chk(x / 10, z / 10);
    for (let i = 0; i < def.line.dxz.length; i += 2) {
      x += def.line.dxz[i] as number;
      z += def.line.dxz[i + 1] as number;
      chk(x / 10, z / 10);
    }
    if (out) f.push(err(9, 'a route point lies outside config/world.bounds.json play'));

    // V12: the par and the hash of the headless canonical bot are present (the bot itself runs in `map:races par`)
    if (!(def.parSec > 0) || !/^[0-9a-f]{16}$/.test(def.parBotHash)) f.push(err(12, `parSec ${def.parSec} and parBotHash ${def.parBotHash}: run pnpm map:races par`));

    // V13: size
    const bytes = inp.json !== undefined ? Buffer.byteLength(inp.json) : Buffer.byteLength(JSON.stringify(def));
    if (bytes > MAX_JSON_BYTES) f.push(err(13, `race.json is ${bytes} bytes (limit ${MAX_JSON_BYTES})`));

    // graph rules
    if (bg) {
      // V1: edge continuity
      for (let i = 1; i < def.route.length; i++) {
        const a = (def.route[i - 1] as RaceDef['route'][number]).edgeIds.at(-1) as number;
        const b = (def.route[i] as RaceDef['route'][number]).edgeIds[0] as number;
        if (!bg.net.has(a) || !bg.net.has(b)) f.push(err(1, `edge ${a} or ${b} is not in the bake`));
        else if (bg.net.to(a) !== bg.net.from(b)) f.push(err(1, `edge ${a} does not lead into edge ${b}`));
      }
      // V2 (a warning): the route turns round on the street it is on, which a one-way street does not allow
      for (let i = 1; i < def.route.length; i++) {
        const a = (def.route[i - 1] as RaceDef['route'][number]).edgeIds.at(-1) as number;
        const b = (def.route[i] as RaceDef['route'][number]).edgeIds[0] as number;
        if (bg.net.has(a) && bg.net.has(b) && bg.net.isReverseOf(b, a)) f.push({ rule: 'V2', level: 'warn', message: `the route turns back on edge ${a} (a U-turn on its own street)` });
      }
      if (def.worldBake !== bg.bakeId) f.push(err(1, `compiled for bake ${def.worldBake.slice(0, 12)}, the open bake is ${bg.bakeId.slice(0, 12)}`));
      // V7: a circuit with traffic closes its side streets
      if (def.kind === 'circuit' && def.traffic !== 'off') {
        let open = 0;
        for (let i = 0; i + 1 < def.route.length; i++) {
          const e = (def.route[i] as RaceDef['route'][number]).edgeIds.at(-1) as number;
          const n = bg.net.to(e);
          const next = (def.route[i + 1] as RaceDef['route'][number]).edgeIds[0] as number;
          for (const o of bg.net.out(n)) {
            if (o === next || bg.net.isReverseOf(o, e)) continue;
            open++;
          }
        }
        if (open > def.closures.length) f.push(err(7, `${open} side streets leave the route, ${def.closures.length} closures`));
      }
    }
  }
  const findings = f;
  return { id: source.id, ok: !findings.some((x) => x.level === 'error'), findings, stats };
}

function classOfVehicle(def: string): VehicleClass | null {
  const known: Record<string, VehicleClass> = {
    'vehicle.ondine-pico': 'D', 'vehicle.kestrel-quill': 'C', 'vehicle.brackenridge-rasp': 'B', 'vehicle.aurelian-sorrel': 'A',
    'vehicle.solenne-skip': 'S', 'vehicle.halcyon-cormorant': 'R',
  };
  return known[def] ?? null;
}
