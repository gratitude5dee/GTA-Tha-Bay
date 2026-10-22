/**
 * Builds `packages/shared/schemas/mission-ir-1.schema.json` (JSON Schema draft 2020-12): the C09 section C3 types as a schema plus the
 * hand-written bounds of section C4. The structure is written once here; the two validation profiles come from the same builder:
 *  - `story`: the full IR;
 *  - `mod` (section C12 item 2): no `give` op, no `rewards`, no `unlocks`, no `modeHooks` and no `mode` objective (so no
 *    `unlockOnFirstEncounter`), flag ops only on `mod.` keys, DirectorScript beats only, act 0 and premise `mod`.
 * The schema file holds `$defs.story` and `$defs.mod` as two roots over shared definitions. M00a's schema generator
 * (`tools/ci/gen-api-schemas.ts`) does not exist in this repository, so this builder is the hand-written route the milestone allows.
 *
 *   tsx packages/shared/scripts/gen-mission-schema.ts          writes the file
 *   tsx packages/shared/scripts/gen-mission-schema.ts --check  exits 1 when the file differs
 */
type J = Record<string, unknown>;

const re = {
  loc: '^[a-z0-9_.-]{1,96}$',
  line: '^line\\.[a-z0-9_.-]{1,90}$',
  name: '^[a-z][a-z0-9_]{0,31}$',
  who: '^(player|playerVehicle|[a-z][a-z0-9_]{0,31})$',
  mission: '^m\\.[a-z0-9][a-z0-9.-]{1,80}$',
  landmark: '^lm\\.[a-z0-9][a-z0-9.-]{0,60}$',
  unlock: '^unlock\\.[a-z0-9._]{1,60}$',
  soul: '^[a-z][a-z0-9_-]{0,47}$',
  id: '^[a-z][a-z0-9_-]{0,31}$',
  key: '^[a-z][a-z0-9_.]{0,47}$',
  tag: '^[a-z][a-z0-9_.-]{0,47}$',
  prefab: '^[a-z0-9][a-z0-9_.-]{0,63}$',
  idem: '^[a-z0-9][a-z0-9_.:-]{0,63}$',
  knot: '^mission_[a-z0-9_]{1,120}$',
  cut: '^cut\\.[a-z0-9_.-]{1,120}$',
  director: '^[a-z0-9][a-z0-9_.-]{0,80}$',
  flagStr: '^[a-z0-9_.-]{0,64}$',
  bake: '^[a-z0-9._-]{1,80}$',
};

const ref = (n: string): J => ({ $ref: `#/$defs/${n}` });
const str = (pattern: string): J => ({ type: 'string', pattern });
const num = (min?: number, max?: number): J => ({ type: 'number', ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
const int = (min?: number, max?: number): J => ({ type: 'integer', ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
const arr = (items: J, min?: number, max?: number): J => ({ type: 'array', items, ...(min !== undefined ? { minItems: min } : {}), ...(max !== undefined ? { maxItems: max } : {}) });
const tuple = (a: J, b: J): J => ({ type: 'array', prefixItems: [a, b], items: false, minItems: 2, maxItems: 2 });
const lit = (v: string | number | boolean): J => ({ const: v });
const anyOf = (options: J[]): J => ({ anyOf: options });
/** A union tagged by `key`: Ajv's discriminator keyword reports the one branch the tag selects. */
const tagged = (key: string, options: J[]): J => ({ discriminator: { propertyName: key }, oneOf: options });
const rec = (keyPattern: string, value: J, max?: number): J => ({
  type: 'object', propertyNames: { pattern: keyPattern }, additionalProperties: value, ...(max !== undefined ? { maxProperties: max } : {}),
});

/** An object with exactly these properties; `req` are required. */
function obj(props: Record<string, J>, req: string[] = Object.keys(props), extra: J = {}): J {
  return { type: 'object', properties: props, required: req, additionalProperties: false, ...extra };
}
/** `obj` with a discriminator property fixed to `value` (a string, or an enum of strings). */
function branch(key: string, value: string | string[], props: Record<string, J>, opt: string[] = []): J {
  const disc: J = Array.isArray(value) ? { enum: value } : lit(value);
  const all = { [key]: disc, ...props };
  return obj(all, Object.keys(all).filter((k) => k === key || !opt.includes(k)));
}

const BOOL_NUM_STR = anyOf([{ type: 'boolean' }, num(), str(re.flagStr)]);
const HEAT = int(0, 6);
const WEATHER = { enum: ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'] };
const SEC = num(0.05, 600);
const FLAG_VALUE = BOOL_NUM_STR;

function build(profile: 'story' | 'mod'): { defs: Record<string, J>; root: J } {
  const mod = profile === 'mod';

  const defs: Record<string, J> = {
    LocKey: str(re.loc), LineId: str(re.line), CastName: str(re.name), ZoneName: str(re.name), Who: str(re.who),
    MissionId: str(re.mission), LandmarkId: str(re.landmark), UnlockEventId: str(re.unlock),
    LatLngTuple: tuple(num(-90, 90), num(-180, 180)),
    Heat: HEAT, Weather: WEATHER,
    Placement: obj(
      {
        at: anyOf([ref('LatLngTuple'), obj({ landmark: ref('LandmarkId') })]),
        yawDeg: num(-360, 360), snap: { enum: ['ground', 'road', 'sidewalk', 'none'] }, y: num(-100, 1000),
      },
      ['at', 'snap'],
    ),
    BeatRef: anyOf(mod ? [obj({ director: str(re.director) })] : [obj({ cutscene: str(re.cut) }), obj({ director: str(re.director) })]),
    FlagMap: rec(re.key, FLAG_VALUE, 32),
  };

  defs['Trigger'] = tagged('k', [
    branch('k', 'marker', { at: ref('Placement'), radiusM: num(1, 500), onFoot: { type: 'boolean' }, hours: tuple(num(0, 24), num(0, 24)) }, ['onFoot', 'hours']),
    branch('k', 'phone', { contact: str(re.soul), delaySec: num(0, 3600) }, ['delaySec']),
    branch('k', 'auto', { when: ref('Pred') }),
    branch('k', 'mode', { mode: anyOf([lit('sandbox'), str('^exp:[a-z0-9][a-z0-9_.-]{0,40}$')]) }),
  ]);

  const spawnAt = { enum: ['start', 'manual'] };
  const roles = { enum: ['ally', 'mentor', 'rival', 'host', 'opponent', 'cameo', 'antagonist', 'civilian', 'unit'] };
  defs['CastDef'] = tagged('k', [
    branch('k', 'npc', {
      who: anyOf([obj({ soul: str(re.soul) }), obj({ slot: { enum: ['RAP_HYPHY_ELDER', 'RAP_LYRICIST', 'RAP_NEW_WAVE', 'RAP_COLLECTIVE', 'TECH_VISIONARY', 'TECH_HACKER', 'TECH_VC', 'ATH_SHOOTER', 'ATH_POWER_BACK', 'INFLUENCER'] } })]),
      role: roles, spawn: ref('Placement'), prefab: str(re.prefab), spawnAt,
    }, ['spawn', 'prefab', 'spawnAt']),
    branch('k', 'vehicle', { prefab: str(re.prefab), spawn: ref('Placement'), role: roles, playerUsable: { type: 'boolean' }, spawnAt }, ['role', 'playerUsable', 'spawnAt']),
    branch('k', ['prop', 'pickup'], { prefab: str(re.prefab), spawn: ref('Placement'), item: str(re.prefab), spawnAt }, ['item', 'spawnAt']),
    branch('k', 'unit', { prefab: str('^police\\.[a-z0-9_.-]{1,56}$'), spawn: ref('Placement'), spawnAt }, ['spawnAt']),
  ]);

  defs['ZoneDef'] = tagged('k', [
    branch('k', 'circle', { at: ref('LatLngTuple'), r: num(2, 2000) }),
    branch('k', 'poly', { ring: arr(ref('LatLngTuple'), 3, 64), yMin: num(-100, 1000), yMax: num(-100, 1000) }, ['yMin', 'yMax']),
    branch('k', 'landmark', { id: ref('LandmarkId'), r: num(2, 2000) }, ['r']),
    branch('k', 'route', { via: arr(ref('LatLngTuple'), 2, 64), widthM: num(1, 200) }),
    branch('k', 'cast', { cast: ref('CastName'), r: num(1, 2000) }),
  ]);

  const baseObj = { id: str(re.id), text: ref('LocKey'), optional: { type: 'boolean' }, marker: { type: 'boolean' } };
  const objective = (k: string | string[], props: Record<string, J>, opt: string[] = []): J => {
    const all = { k: Array.isArray(k) ? { enum: k } : lit(k), ...baseObj, ...props };
    return obj(all, Object.keys(all).filter((x) => !['optional', 'marker', ...opt].includes(x)));
  };
  const outcome = obj(
    { stage: str(re.id), flags: ref('FlagMap'), trust: num(-100, 100), label: ref('LocKey'), when: obj({ actions: arr({ enum: ['none', 'offer_mission', 'offer_race', 'offer_fight', 'offer_deal', 'give_item', 'sell', 'refuse', 'call_police', 'flee', 'attack', 'follow', 'leave'] }, 1, 13), minTrust: num(-100, 100), mood: arr(str(re.key), 1, 8) }, []) },
    ['label'],
  );
  defs['TalkDef'] = obj({
    id: str(re.id), npc: ref('CastName'), intent: ref('LocKey'),
    outcomes: { type: 'object', propertyNames: { pattern: re.id }, additionalProperties: outcome, minProperties: 1, maxProperties: 12 },
    default: str(re.id), maxTurns: int(1, 12), ink: str(re.knot),
  });
  const objs: J[] = [
    objective('goto', { zone: ref('ZoneName'), onFoot: { type: 'boolean' }, inVehicle: str(re.who), stopped: { type: 'boolean' } }, ['onFoot', 'inVehicle', 'stopped']),
    objective('enterVehicle', { vehicle: str(re.who) }),
    objective('follow', { target: ref('CastName'), band: tuple(num(1, 200), num(1, 400)), loseAfterSec: SEC, untilZone: ref('ZoneName'), untilEvent: str(re.key) }, ['untilZone', 'untilEvent']),
    objective('chase', { target: ref('CastName'), catchDist: num(1, 100), holdSec: SEC }, ['holdSec']),
    objective('escape', { untilHeat: lit(0) }),
    objective('survive', { sec: SEC }),
    objective('collect', { cast: ref('CastName') }),
    objective('deliver', { cast: ref('CastName'), to: ref('ZoneName'), fragile: num(0, 1) }, ['fragile']),
    objective('protect', { target: ref('CastName'), minHealth: num(0, 1), sec: SEC, untilZone: ref('ZoneName') }, ['sec', 'untilZone']),
    objective('talk', { talk: ref('TalkDef') }),
    objective('photo', { subject: anyOf([ref('CastName'), ref('LandmarkId')]), framing: { enum: ['any', 'wide', 'selfie'] }, maxDistM: num(1, 500) }, ['framing', 'maxDistM']),
    objective('stealth', { zone: ref('ZoneName'), detectBudget: int(0, 100), autoplayPath: arr(ref('LatLngTuple'), 1, 64) }),
    objective('defeat', { targets: arr(ref('CastName'), 1, 16), nonLethal: lit(true) }),
    objective('score', { metric: { enum: ['drift', 'airtime', 'nearMiss'] }, target: num(1, 1_000_000), withinSec: SEC }),
    objective('wait', { sec: SEC }),
  ];
  // The mode objective names a hook of the mission; the mod profile has no hooks and so no mode objective. The hook's stub is an
  // ObjectiveDef that is never a mode objective (`ObjectiveNoMode`).
  defs['ObjectiveNoMode'] = tagged('k', objs);
  defs['ObjectiveDef'] = tagged('k', mod ? objs : [...objs, objective('mode', { hook: str(re.id) })]);

  defs['ModeHook'] = obj(
    {
      id: str(re.id), mode: { enum: ['racing', 'fighter', 'tycoon'] }, defId: str(re.prefab), params: { type: 'object', maxProperties: 16 },
      passOn: arr({ enum: ['win', 'finish', 'lose', 'quit'] }, 1, 4), stub: ref('ObjectiveNoMode'), unlockOnFirstEncounter: ref('UnlockEventId'), retry: { enum: ['hook', 'checkpoint'] },
    },
    ['id', 'mode', 'defId', 'passOn', 'stub', 'retry'],
  );

  const task = tagged('t', [
    branch('t', 'goto', { zone: ref('ZoneName'), mode: { enum: ['walk', 'run', 'drive'] } }),
    branch('t', 'driveTo', { zone: ref('ZoneName'), style: { enum: ['normal', 'fast', 'flee'] } }),
    branch('t', 'follow', { who: ref('Who'), distM: num(1, 200) }),
    branch('t', 'enterVehicle', { vehicle: ref('CastName'), seat: int(0, 7) }),
    branch('t', 'leaveVehicle', {}),
    branch('t', 'anim', { clip: str(re.key), loop: { type: 'boolean' } }, ['loop']),
    branch('t', 'look', { who: ref('Who') }),
    branch('t', 'idle', {}),
    branch('t', 'flee', { from: ref('Who') }),
  ]);
  defs['NpcTask'] = task;

  const flagKey = mod ? '^mod\\.[a-z0-9_.]{1,44}$' : re.key;
  const ops: J[] = [
    branch('op', 'seq', { body: ref('Ops') }),
    branch('op', 'all', { branches: arr(ref('Ops'), 1, 16) }),
    branch('op', 'race', { branches: arr(ref('Ops'), 1, 16) }),
    branch('op', 'if', { cond: ref('Pred'), then: ref('Ops'), else: ref('Ops') }, ['else']),
    branch('op', 'loop', { max: int(1, 10000), until: ref('Pred'), body: ref('Ops') }, ['until']),
    branch('op', 'wait', { sec: SEC }),
    branch('op', 'waitUntil', { cond: ref('Pred'), timeoutSec: SEC, onTimeout: ref('Ops') }, ['timeoutSec', 'onTimeout']),
    branch('op', 'waitEvent', { event: str(re.key), timeoutSec: SEC }, ['timeoutSec']),
    branch('op', ['spawn', 'despawn'], { cast: arr(ref('CastName'), 1, 32) }),
    branch('op', 'task', { cast: ref('CastName'), task: ref('NpcTask') }),
    branch('op', 'say', { speaker: anyOf([lit('player'), lit('radio'), ref('CastName')]), line: ref('LineId'), wait: { type: 'boolean' } }, ['wait']),
    branch('op', 'text', { from: str(re.soul), line: ref('LineId') }),
    branch('op', 'marker', { target: ref('CastName'), kind: { enum: ['objective', 'destination', 'target', 'avoid'] }, on: { type: 'boolean' } }),
    branch('op', 'beat', { ref: ref('BeatRef') }),
    branch('op', 'camera', { shot: str(re.director), subject: ref('Who'), sec: SEC }, ['subject', 'sec']),
    branch('op', 'fade', { to: anyOf([lit(0), lit(1)]), sec: num(0, 60) }),
    branch('op', 'heat', { set: HEAT, cap: HEAT, clear: lit(true), unit: ref('CastName') }, ['set', 'cap', 'clear', 'unit']),
    branch('op', 'clock', { lock: obj({ hour: num(0, 24), weather: WEATHER }, []), unlock: lit(true) }, ['lock', 'unlock']),
    branch('op', 'ambient', { traffic: num(0, 1), peds: num(0, 1) }, ['traffic', 'peds']),
    branch('op', 'flag', { set: rec(flagKey, FLAG_VALUE, 16) }),
    branch('op', 'trust', { npc: ref('CastName'), delta: num(-100, 100) }),
    ...(mod ? [] : [branch('op', 'give', { items: arr(obj({ id: str(re.prefab), qty: int(1, 999) }), 1, 8), cashCents: int(0, 100_000_000), idem: str(re.idem) }, ['items', 'cashCents'])]),
    branch('op', 'emit', { event: str(re.key) }),
    branch('op', 'pass', {}),
    branch('op', 'fail', { reason: ref('LocKey') }),
  ];
  defs['Op'] = tagged('op', ops);
  defs['Ops'] = arr(ref('Op'), 0, 256);

  const who = ref('Who');
  const preds: J[] = [
    branch('p', ['and', 'or'], { of: arr(ref('Pred'), 1, 16) }),
    branch('p', 'not', { of: ref('Pred') }),
    branch('p', 'true', {}),
    branch('p', 'inZone', { who, zone: ref('ZoneName') }),
    branch('p', 'inVehicle', { who, vehicle: str(re.who) }, ['vehicle']),
    branch('p', 'near', { a: who, b: who, maxM: num(0, 5000) }),
    branch('p', 'far', { a: who, b: who, minM: num(0, 5000) }),
    branch('p', 'health', { who, below: num(0, 1) }),
    branch('p', 'ko', { who }),
    branch('p', 'destroyed', { cast: ref('CastName') }),
    branch('p', 'busted', {}),
    branch('p', 'heat', { min: HEAT, max: HEAT, phase: { enum: ['clear', 'pursuit', 'search', 'cooldown'] } }, ['min', 'max', 'phase']),
    branch('p', 'speed', { who, minMps: num(0, 200), maxMps: num(0, 200) }, ['minMps', 'maxMps']),
    branch('p', 'hour', { from: num(0, 24), to: num(0, 24) }),
    branch('p', 'weather', { is: arr(WEATHER, 1, 6) }),
    branch('p', 'flag', { key: str(re.key), eq: FLAG_VALUE, gte: num() }, ['eq', 'gte']),
    branch('p', 'trust', { npc: str(re.soul), gte: num(-100, 100), lte: num(-100, 100) }, ['gte', 'lte']),
    branch('p', 'item', { id: str(re.prefab), gte: int(0, 999) }),
    branch('p', 'cash', { gteCents: int(0, 100_000_000) }),
    branch('p', 'objective', { id: str(re.id), state: { enum: ['active', 'done', 'failed'] } }),
    branch('p', 'stageTime', { gteSec: num(0, 3600), lteSec: num(0, 3600) }, ['gteSec', 'lteSec']),
    branch('p', 'event', { name: str(re.key), since: { enum: ['stage', 'mission'] } }),
    branch('p', 'modeResult', { hook: str(re.id), outcome: arr({ enum: ['win', 'finish', 'lose', 'quit', 'abort'] }, 1, 5) }),
    branch('p', 'passed', { mission: ref('MissionId') }),
    branch('p', 'act', { gte: { enum: [1, 2, 3] } }),
    branch('p', 'unlocked', { id: ref('UnlockEventId') }),
  ];
  defs['Pred'] = tagged('p', preds);

  defs['StageDef'] = obj(
    {
      id: str(re.id), join: { enum: ['all', 'any', 'sequence'] }, objectives: arr(ref('ObjectiveDef'), 1, 12),
      onEnter: ref('Ops'), onComplete: ref('Ops'), timeLimitSec: num(1, 3600), checkpoint: { type: 'boolean' },
      conduct: { enum: ['lawful', 'unlawful'] }, next: str(re.id),
    },
    ['id', 'join', 'objectives'],
  );
  defs['FailRule'] = obj({ when: ref('Pred'), reason: ref('LocKey'), retry: { enum: ['checkpoint', 'start'] } });
  defs['Rewards'] = obj(
    {
      cashCents: int(0, 100_000_000), streetCred: int(0, 10_000), techClout: int(0, 10_000),
      items: arr(obj({ id: str(re.prefab), qty: int(1, 999) }), 0, 16), vehicles: arr(str(re.prefab), 0, 8), safehouse: str(re.prefab),
      trust: arr(obj({ npc: str(re.soul), delta: num(-100, 100) }), 0, 16),
    },
    [],
    mod ? { maxProperties: 0 } : {},
  );

  const root: Record<string, J> = {
    schema: lit('mission-ir/1'), id: ref('MissionId'), version: int(1, 100000), worldBake: str(re.bake),
    act: mod ? lit(0) : { enum: [0, 1, 2, 3] }, premise: mod ? lit('mod') : { enum: ['hella-valuation', 'mod'] },
    title: ref('LocKey'), district: { enum: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'] }, tags: arr(str(re.tag), 0, 16),
    giver: anyOf([obj({ npc: ref('CastName') }), obj({ phone: str(re.soul) }), obj({ world: lit(true) })]),
    requires: arr(ref('Pred'), 0, 16), start: ref('Trigger'),
    cast: rec(re.name, ref('CastDef'), 32), zones: rec(re.name, ref('ZoneDef'), 48),
    intro: ref('BeatRef'), outro: ref('BeatRef'),
    stages: arr(ref('StageDef'), 1, 16),
    threads: rec(re.name, ref('Ops'), 8),
    fail: arr(ref('FailRule'), 0, 16),
    heatPolicy: obj({ maxHeat: HEAT, clearOnPass: { type: 'boolean' }, startHeat: HEAT }, ['maxHeat', 'clearOnPass']),
    ambient: obj({ traffic: num(0, 1), peds: num(0, 1), lock: obj({ hour: num(0, 24), weather: WEATHER }, []) }, []),
    rewards: ref('Rewards'),
    medals: obj({ silverSec: num(1, 3600), goldSec: num(1, 3600), goldIf: ref('Pred') }, ['silverSec', 'goldSec']),
    ...(mod ? {} : { unlocks: arr(ref('UnlockEventId'), 0, 16), modeHooks: arr(ref('ModeHook'), 0, 8) }),
    autoplay: obj({ expectedSec: tuple(num(10, 3600), num(10, 3600)), seeds: { type: 'array', prefixItems: [int(0, 4294967295), int(0, 4294967295), int(0, 4294967295)], items: false, minItems: 3, maxItems: 3 } }),
    lines: arr(ref('LineId'), 0, 512),
  };
  const required = ['schema', 'id', 'version', 'worldBake', 'act', 'premise', 'title', 'district', 'tags', 'giver', 'requires', 'start', 'cast', 'zones', 'stages', 'fail', 'heatPolicy', 'rewards', 'autoplay', 'lines'];
  return { defs, root: obj(root, required) };
}

/** The full schema document. `$defs.story` and `$defs.mod` are the two profile roots; the top level validates the story profile. */
export function missionIrSchema(): J {
  const story = build('story');
  const mod = build('mod');
  // Shared definitions come from the story build; the definitions that differ in the mod profile are renamed `mod.<Name>`.
  const shared: Record<string, J> = {};
  const modOnly: Record<string, J> = {};
  const rename = (node: unknown, names: Set<string>): unknown => {
    if (Array.isArray(node)) return node.map((x) => rename(x, names));
    if (node && typeof node === 'object') {
      const out: J = {};
      for (const [k, v] of Object.entries(node as J)) {
        if (k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/') && names.has(v.slice(8))) out[k] = `#/$defs/mod.${v.slice(8)}`;
        else out[k] = rename(v, names);
      }
      return out;
    }
    return node;
  };
  const differing = new Set<string>();
  for (const name of Object.keys(story.defs)) {
    if (JSON.stringify(story.defs[name]) !== JSON.stringify(mod.defs[name])) differing.add(name);
  }
  // A definition that refers to a differing one differs too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of Object.keys(story.defs)) {
      if (differing.has(name)) continue;
      if ([...differing].some((d) => JSON.stringify(story.defs[name]).includes(`"#/$defs/${d}"`))) {
        differing.add(name);
        changed = true;
      }
    }
  }
  for (const name of Object.keys(story.defs)) {
    if (differing.has(name)) {
      shared[name] = story.defs[name] as J;
      modOnly[`mod.${name}`] = rename(mod.defs[name], differing) as J;
    } else {
      shared[name] = story.defs[name] as J;
    }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'mission-ir-1',
    title: 'MissionIR (C09 1.0.0)',
    description: 'Mission IR, schema mission-ir/1. $defs.story is the story profile (the top level); $defs.mod is the mod profile (C12 item 2).',
    ...(rename(story.root, new Set()) as J),
    $defs: { ...shared, ...modOnly, story: story.root, mod: rename(mod.root, differing) },
  };
}

/** Returns `$ref`-form roots for the validators: `#` is the story profile, `#/$defs/mod` the mod profile. */
export const MISSION_SCHEMA_PROFILE_REFS = { story: 'mission-ir-1#/$defs/story', mod: 'mission-ir-1#/$defs/mod' } as const;
