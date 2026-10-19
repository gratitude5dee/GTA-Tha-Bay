import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { JsonObject, SliceKind } from '@dv/shared';
import { SAVE_LIMITS } from '@dv/shared';
import {
  CURRENT_SCHEMA,
  DEFAULT_MIGRATIONS,
  SLICE_SCHEMAS,
  canonicalData,
  defaultCore,
  defaultSettings,
  validateEnvelope,
  validateSlice,
  type MigrationRegistry,
} from '../../src/sim/save/index.ts';
import { capabilityFor } from '../../src/sim/save/capability.ts';
import { clock, mkProfile, newStore, openSvc } from './helpers.ts';

const KINDS = ['core', 'settings', 'story', 'sandbox'] as const;
const golden = (kind: string, n = 1): JsonObject =>
  JSON.parse(readFileSync(new URL(`../../src/sim/save/__golden__/${kind}/v${n}.json`, import.meta.url), 'utf8')) as JsonObject;
const slotOf = (kind: (typeof KINDS)[number]): 'core' | 'settings' | 'story:1' | 'sandbox' => (kind === 'story' ? 'story:1' : kind);

describe('engine/save.migrateGolden', () => {
  it.each(KINDS)('the %s v1 golden validates against its schema (built-in validator and Ajv agree)', (kind) => {
    const data = golden(kind);
    expect(validateSlice(kind, 1, data)).toBeNull();
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(SLICE_SCHEMAS[kind]![1] as object);
    expect(validate(data)).toBe(true);
    // A broken copy fails in both.
    const broken = { ...data, [Object.keys(data)[0]!]: 'nope' };
    expect(validateSlice(kind, 1, broken)).not.toBeNull();
    expect(ajv.compile(SLICE_SCHEMAS[kind]![1] as object)(broken)).toBe(false);
  });

  it('the defaults validate against the v1 schemas', () => {
    expect(validateSlice('core', 1, defaultCore())).toBeNull();
    expect(validateSlice('settings', 1, defaultSettings())).toBeNull();
  });

  it('the record envelope schema rejects a malformed record', () => {
    const rec = { format: 'dv-save', kind: 'core', slot: 'core', profileId: 'a'.repeat(32), schema: 1, gen: 1, savedAt: 1, playtimeSec: 0, deviceId: 'b'.repeat(32), buildId: 'x', worldBake: 'y', bytes: 2, checksum: '0'.repeat(16), data: {} };
    expect(validateEnvelope(rec)).toBeNull();
    expect(validateEnvelope({ ...rec, slot: 'story:9' })).not.toBeNull();
    expect(validateEnvelope({ ...rec, checksum: 'zz' })).not.toBeNull();
    expect(validateEnvelope({ ...rec, extra: 1 })).not.toBeNull();
  });

  it('the story golden is under the story budget', () => {
    const { bytes } = canonicalData(golden('story'));
    expect(bytes).toBeLessThan(SAVE_LIMITS.storyTargetBytes);
  });

  it.each(KINDS)('the %s golden round-trips through the service (write, load) at gen 1', async (kind) => {
    const svc = await openSvc(await newStore('memory'), { capability: capabilityFor(slotOf(kind)), now: clock().now });
    const p = await mkProfile(svc);
    const data = golden(kind);
    expect(await svc.write(slotOf(kind), data, 'manual')).toMatchObject({ ok: true, gen: 1 });
    const g = await svc.load(p.id);
    const got = kind === 'core' ? g.core : kind === 'settings' ? g.settings : kind === 'story' ? g.story['1'] : g.sandbox;
    expect(got).toEqual(data);
    expect((await svc.describeSlot(p.id, slotOf(kind)))?.gen).toBe(1);
  });

  it('every golden kind has a current schema number with a golden file and a schema file', () => {
    for (const kind of KINDS) {
      for (let n = 1; n <= CURRENT_SCHEMA[kind as SliceKind]; n++) {
        expect(() => golden(kind, n)).not.toThrow();
        expect(SLICE_SCHEMAS[kind]![n]).toBeDefined();
      }
    }
  });

  it('migration steps run in order: a v1 record loads as v3 through two steps', async () => {
    const store = await newStore('memory');
    const v1 = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(v1);
    await v1.write('sandbox', { toggles: {} }, 'manual');
    const reg: MigrationRegistry = {
      current: { ...DEFAULT_MIGRATIONS.current, sandbox: 3 },
      steps: { sandbox: { 1: (d) => ({ ...d, a: 1 }), 2: (d) => ({ ...d, b: (d['a'] as number) + 1 }) } },
    };
    const v3 = await openSvc(store, { migrations: reg, now: clock().now });
    const g = await v3.load(p.id);
    expect(g.sandbox).toEqual({ toggles: {}, a: 1, b: 2 });
    // The stored record stays at schema 1 until the next write.
    expect((await store.getRecord(p.id, 'sandbox', 1))?.schema).toBe(1);
  });

  it('a record with a newer schema loads read-only with NEWER_SCHEMA', async () => {
    const store = await newStore('memory');
    const reg2: MigrationRegistry = { current: { ...DEFAULT_MIGRATIONS.current, sandbox: 2 }, steps: {} };
    const newer = await openSvc(store, { migrations: reg2, capability: 'sandbox', now: clock().now });
    const p = await mkProfile(newer);
    await newer.write('sandbox', { toggles: { future: true } }, 'manual');

    const old = await openSvc(store, { capability: 'sandbox', now: clock().now });
    const g = await old.load(p.id);
    expect(g.sandbox).toEqual({ toggles: { future: true } });
    expect(g.profile.lastSave).toMatchObject({ ok: false, error: 'NEWER_SCHEMA' });
    expect(old.readOnly).toBe('newer-schema');
    expect(await old.write('sandbox', { toggles: {} }, 'manual')).toMatchObject({ ok: false, error: 'NEWER_SCHEMA' });
    expect((await store.getRecord(p.id, 'sandbox', 1))?.schema).toBe(2); // untouched
  });

  it('a throwing migration leaves the stored record untouched and loads the previous generation', async () => {
    const store = await newStore('memory');
    const reg: MigrationRegistry = {
      current: { ...DEFAULT_MIGRATIONS.current, sandbox: 2 },
      steps: { sandbox: { 1: () => { throw new Error('boom'); } } },
    };
    const svc = await openSvc(store, { migrations: reg, capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    await svc.write('sandbox', { toggles: { n: 1 } }, 'manual'); // gen 1, schema 2
    await svc.write('sandbox', { toggles: { n: 2 } }, 'manual'); // gen 2, schema 2
    // Turn gen 2 into a schema-1 record (same data, so its checksum still verifies).
    const rec = await store.getRecord(p.id, 'sandbox', 2);
    await store.deleteRecord(p.id, 'sandbox', 2);
    await store.addRecord({ ...rec!, schema: 1 });
    const before = JSON.stringify(await store.getRecord(p.id, 'sandbox', 2));

    const reader = await openSvc(store, { migrations: reg, now: clock().now });
    const g = await reader.load(p.id);
    expect(g.sandbox).toEqual({ toggles: { n: 1 } });
    expect(g.profile.lastSave).toMatchObject({ ok: false, error: 'INVALID' });
    expect(JSON.stringify(await store.getRecord(p.id, 'sandbox', 2))).toBe(before);
  });
});
