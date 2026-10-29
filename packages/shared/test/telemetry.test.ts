import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { CLIENT_TELEMETRY_NAMES, C12_VERSION, C16_VERSION, HTTP_FOR, SERVER_ONLY_TELEMETRY_NAMES } from '../src/index.ts';

const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../schemas/telemetry/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

const batchSchema = load('batch.schema.json');
const namesSchema = load('names.schema.json') as { $defs: Record<string, object> };

const valid = {
  v: 1,
  build: 'abc',
  seq0: 0,
  env: { tier: 'desktop', deviceClass: 'desktop', osMajor: 15, displayMode: 'tab', backend: 'webgl2' },
  events: [{ name: 'storage.persist', ts: 1, sessionId: 's', props: { granted: true } }],
};

describe('C16 telemetry schemas', () => {
  const ajv = new Ajv2020({ strict: false });
  const validateBatch = ajv.compile(batchSchema);

  it('versions match the contracts', () => {
    expect(C12_VERSION).toBe('1.1.0');
    expect(C16_VERSION).toBe('1.2.0');
    expect(HTTP_FOR.region_blocked).toBe(451);
  });

  it('accepts a valid batch and rejects bad envelopes and limits', () => {
    expect(validateBatch(valid)).toBe(true);
    expect(validateBatch({ ...valid, v: 2 })).toBe(false);
    expect(validateBatch({ ...valid, env: { ...valid.env, tier: 'ultra' } })).toBe(false);
    expect(validateBatch({ ...valid, events: Array.from({ length: 51 }, () => valid.events[0]) })).toBe(false);
    expect(validateBatch({ ...valid, events: [{ ...valid.events[0], props: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])) }] })).toBe(false);
  });

  it('names.schema.json covers the M00a names, err.asset (M01e), world.stream (M02b1) the mode names (M04a2) the mission names (M05a1), the racing names (M07a1) and cutscene.play (M05b2), plus the server-only quota.block (M06a1), npc.turn.client, npc.encounter.client and the server-only genai.cost (M06a3), npc.voice.client (M06a4), npc.builder.step (M06b1), racing.pursuit_end, racing.replay_view and the server-only racing.verify_fail (M07a2), fight.end (M08a2)', () => {
    const names = Object.keys(namesSchema.$defs);
    expect(names.sort()).toEqual(
      ['app.start', 'app.ready', 'app.hidden', 'app.abnormal_exit', 'app.cold_resume', 'err.js', 'err.promise', 'err.gpu', 'err.asset', 'perf.minute', 'tier.decision', 'storage.persist', 'pwa.install', 'ui.onboard', 'ui.page', 'world.stream', 'mode.enter', 'mode.exit', 'unlock.emit', 'mission.start', 'mission.fail', 'mission.complete', 'err.sim', 'racing.start', 'racing.finish', 'racing.pursuit_end', 'racing.replay_view', 'racing.verify_fail', 'cutscene.play', 'quota.block', 'npc.turn.client', 'npc.encounter.client', 'npc.voice.client', 'npc.builder.step', 'genai.cost', 'fight.end', 'app.crash'].sort(),
    );
    // quota.block is server-only: it has a schema for the AE layout but is not a client name, so the ingest route drops it from a client batch.
    for (const n of names.filter((x) => x !== 'quota.block' && x !== 'genai.cost' && x !== 'racing.verify_fail' && x !== 'app.crash')) expect(CLIENT_TELEMETRY_NAMES as readonly string[]).toContain(n);
    expect(CLIENT_TELEMETRY_NAMES as readonly string[]).not.toContain('quota.block');
    expect(CLIENT_TELEMETRY_NAMES as readonly string[]).not.toContain('genai.cost');
  });

  it('each per-name schema is a valid schema and accepts its own required props', () => {
    for (const [name, def] of Object.entries(namesSchema.$defs)) {
      const validate = ajv.compile(def);
      const props: Record<string, unknown> = {};
      const d = def as { properties: Record<string, { type?: string; enum?: unknown[] }>; required: string[] };
      for (const key of d.required) {
        const p = d.properties[key]!;
        props[key] = p.enum ? p.enum[0] : p.type === 'boolean' ? true : p.type === 'number' || p.type === 'integer' ? 1 : 'x';
      }
      expect(validate(props), name).toBe(true);
      expect(validate({ ...props, extra: 1 }), `${name} rejects unknown props`).toBe(false);
    }
  });

  it('app.crash is server-only (C16 1.2) and app.crash.json is the same schema as its names.schema.json entry', () => {
    expect(SERVER_ONLY_TELEMETRY_NAMES as readonly string[]).toContain('app.crash');
    expect(CLIENT_TELEMETRY_NAMES as readonly string[]).not.toContain('app.crash');
    const { $schema: _s, $id: _i, title: _t, ...single } = load('app.crash.json');
    expect(single).toEqual(namesSchema.$defs['app.crash']);
    const validate = ajv.compile(single);
    expect(validate({ reason: 'oom', build: 'b1' })).toBe(true);
    expect(validate({ reason: 'oom', build: 'b1', path: '/x' })).toBe(false);
    expect(validate({ reason: 'gpu', build: 'b1' })).toBe(false);
  });

  it('client and server-only name lists do not overlap', () => {
    for (const n of SERVER_ONLY_TELEMETRY_NAMES) expect(CLIENT_TELEMETRY_NAMES as readonly string[]).not.toContain(n);
  });
});
