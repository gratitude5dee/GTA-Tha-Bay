/**
 * AC-12: in a production-mode registry racing is `comingSoon`, its lazy imports resolve, `unlock.racing` and the four class
 * unlocks validate, and starting from the menu is refused; the QA start works only when the host is a QA host.
 * Also the config schema (`config/racing.json`) and the C01/C04 id blocks.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { COMPONENT_ID_RANGES } from '@dv/shared';
import { makeRig } from '../../../engine/test/modes/fixture.ts';
import { RACING_ANIM, RACING_ANIM_MAX, RACING_ANIM_MIN } from '../src/anim-states.ts';
import { RACE_CARS, racingDescriptor, racingUnlockDefs, RACING_CONFIG, RACING_COMPONENTS } from '../src/index.ts';

describe('racing descriptor', () => {
  const d = racingDescriptor();

  it('is the C06 descriptor of the spec: id, tile order 2, ui/mode-racing, standalone and embeddable, canonical standalone profile, slot mode:racing', () => {
    expect(d.id).toBe('racing');
    expect(d.tile).toEqual({ art: 'ui/mode-racing', order: 2 });
    expect(d.standalone).toBe(true);
    expect(d.embeddable).toBe(true);
    expect(d.standaloneProfile).toBe('canonical');
    expect(d.saveSlot).toBe('mode:racing');
    expect(d.sliceSchema).toBe(1);
    expect(d.unlock).toBe('unlock.racing');
    expect(d.requires.world).toBe('city');
    expect(d.requires.physics).toBe(true);
  });

  it('is comingSoon, and its lazy sim and ui imports resolve', async () => {
    expect(d.status).toBe('comingSoon');
    const sim = (await d.sim()).default;
    expect(typeof sim.enter).toBe('function');
    expect(typeof sim.tick).toBe('function');
    expect(typeof sim.exit).toBe('function');
    expect(sim.saveSlice({} as never)).toBeNull();
    const ui = (await d.ui()).default;
    expect(typeof ui.mount).toBe('function');
    expect(ui.inputContexts).toEqual(['vehicle']);
  });

  it('starting from the menu is refused in a production host, also after the unlock; the QA start needs a QA host', () => {
    const prod = makeRig({ qa: false, descriptors: [racingDescriptor()] });
    prod.unlocks.register(racingUnlockDefs());
    expect(prod.host.start('racing')).toEqual({ ok: false, reason: 'coming-soon' });
    prod.unlocks.emit('unlock.racing', { kind: 'debug', ref: '' });
    expect(prod.host.start('racing')).toEqual({ ok: false, reason: 'coming-soon' });
    expect(prod.host.startQa('racing')).toEqual({ ok: false, reason: 'unknown' });
    expect(prod.host.state).toBe('Idle');
    const qa = makeRig({ qa: true, descriptors: [racingDescriptor()] });
    expect(qa.host.start('racing')).toEqual({ ok: false, reason: 'coming-soon' });
    expect(qa.host.startQa('racing', { defId: 'sf.sprint.ferry-ocean-beach' })).toEqual({ ok: true });
    expect(qa.host.state).toBe('Loading');
    expect(qa.host.stack.root?.id).toBe('racing');
  });

  it('a QA start without the racing sim module ends the mode with an error instead of hanging', async () => {
    const qa = makeRig({ qa: true, descriptors: [racingDescriptor()] });
    qa.host.startQa('racing');
    // the sim half is a dynamic import: let it settle, ticking the host meanwhile
    for (let i = 0; i < 400 && qa.host.state !== 'Idle'; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await qa.run(1);
    }
    expect(qa.host.state).toBe('Idle');
  });
});

describe('racing unlocks', () => {
  const defs = racingUnlockDefs();

  it('has unlock.racing with the starter loaner and the four class unlocks', () => {
    expect(defs.map((u) => u.id)).toEqual(['unlock.racing', 'unlock.racing.class.c', 'unlock.racing.class.b', 'unlock.racing.class.a', 'unlock.racing.class.s']);
    for (const u of defs) {
      expect(u.id).toMatch(/^unlock\.[a-z0-9._]+$/);
      expect(u.titleKey).toMatch(/^[a-z][a-z0-9._]+$/);
      expect(u.source).toBe('base');
    }
    expect(defs[0]!.grants).toEqual({ menuTile: 'racing', vehicles: ['vehicle.ondine-pico'] });
    const cars = new Set(RACE_CARS.map((c) => c.vehicleDef));
    for (const u of defs) for (const v of u.grants.vehicles ?? []) expect(cars.has(v), v).toBe(true);
    expect(defs.slice(1).map((u) => u.grants.vehicles)).toEqual([['vehicle.kestrel-quill'], ['vehicle.brackenridge-rasp'], ['vehicle.aurelian-sorrel'], ['vehicle.solenne-skip']]);
  });

  it('registers and emits through the unlock registry; the class unlocks are idempotent', () => {
    const rig = makeRig({ qa: false, descriptors: [racingDescriptor()] });
    rig.unlocks.register(racingUnlockDefs());
    expect(rig.unlocks.emit('unlock.racing.class.c', { kind: 'mode', ref: 'racing' })).toBe(true);
    expect(rig.unlocks.emit('unlock.racing.class.c', { kind: 'mode', ref: 'racing' })).toBe(false);
    expect(rig.unlocks.has('unlock.racing.class.c')).toBe(true);
    expect(rig.unlocks.defs().find((u) => u.id === 'unlock.racing')?.grants.vehicles).toEqual(['vehicle.ondine-pico']);
  });
});

describe('config and ids', () => {
  it('config/racing.json validates against config/schemas/racing.schema.json', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../../config/schemas/racing.schema.json', import.meta.url), 'utf8')) as object;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validate(RACING_CONFIG), JSON.stringify(validate.errors)).toBe(true);
    expect(RACING_CONFIG.race.countdownTicks).toBe(180);
    expect(RACING_CONFIG.damage.k).toBe(0.0016);
  });

  it('components 1024 to 1031 are in the racing block of C01, owned by S06; the anim ids are in 128 to 159', () => {
    const [lo, hi] = COMPONENT_ID_RANGES.racing;
    expect(RACING_COMPONENTS.map((c) => c.id)).toEqual([1024, 1025, 1026, 1027, 1028, 1029, 1030, 1031]);
    for (const c of RACING_COMPONENTS) {
      expect(c.id).toBeGreaterThanOrEqual(lo);
      expect(c.id).toBeLessThanOrEqual(hi);
      expect(c.owner).toBe('S06');
    }
    expect(RACING_COMPONENTS.map((c) => c.hashed)).toEqual([true, true, true, true, true, true, false, false]);
    for (const a of Object.values(RACING_ANIM)) {
      expect(a).toBeGreaterThanOrEqual(RACING_ANIM_MIN);
      expect(a).toBeLessThanOrEqual(RACING_ANIM_MAX);
    }
  });
});
