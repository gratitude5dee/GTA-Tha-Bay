import { describe, expect, it } from 'vitest';
import { Fnv64 } from '@dv/shared';
import { ByteReader, ByteWriter } from '@dv/engine/sim';
import { BLACKOUT_DEBUG_OWNER, BLACKOUT_RESOURCE, BLACKOUT_SIDE_KEY, Blackout } from '../src/sim/env/blackout.ts';
import { createWorldStreamingModule } from '../src/sim/streaming/module.ts';

describe('Blackout (M02b2)', () => {
  it('is on while any owner holds it; each owner releases only its own hold', () => {
    const b = new Blackout();
    expect(b.on).toBe(false);
    b.set(true, 'traffic');
    b.set(true, 'debug');
    b.set(true, 'debug');
    expect(b.owners()).toEqual(['debug', 'traffic']);
    b.set(false, 'mission');
    expect(b.on).toBe(true);
    b.set(false, 'debug');
    expect(b.on).toBe(true);
    b.set(false, 'traffic');
    expect(b.on).toBe(false);
    b.set(true, '');
    expect(b.on).toBe(false);
  });

  it('publishes bo = 1 in the snapshot side block while on', () => {
    const b = new Blackout();
    expect(b.side()).toEqual({});
    b.set(true, BLACKOUT_DEBUG_OWNER);
    expect(b.side()).toEqual({ [BLACKOUT_SIDE_KEY]: 1 });
  });

  it('is a hashed, checkpointed resource', () => {
    const a = new Blackout();
    const hex = (b: Blackout): string => {
      const h = new Fnv64();
      b.resource().hash(h);
      return h.hex();
    };
    const empty = hex(a);
    a.set(true, 'x');
    expect(hex(a)).not.toBe(empty);
    const w = new ByteWriter();
    a.resource().save(w);
    const c = new Blackout();
    c.resource().load(new ByteReader(w.toBytes()));
    expect(c.owners()).toEqual(['x']);
    expect(hex(c)).toBe(hex(a));
    expect(a.resource().name).toBe(BLACKOUT_RESOURCE);
  });
});

describe('the world module (M02b2)', () => {
  it('is inert without a world: no side entries and the debug blackout is ignored', () => {
    const m = createWorldStreamingModule();
    m.onDebug?.({ t: 'debug.blackout', on: true });
    expect(m.blackout.on).toBe(false);
    expect(m.side?.()).toEqual({});
  });
});
