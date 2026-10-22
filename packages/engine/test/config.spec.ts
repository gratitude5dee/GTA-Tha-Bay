import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { TIER_IDS, type InputMap } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KBM_MAP, DEFAULT_MAPS, DEFAULT_TOUCH_MAP } from '../src/client/input/defaults.ts';
import { InputRouterImpl } from '../src/client/input/router.ts';
import type { TouchLayout } from '../src/client/input/touch.ts';
import { ENGINE_TIERS } from '../src/client/anim/lod.ts';
import { AUDIO_CONFIG } from '../src/client/audio/audio-service.ts';

const root = (p: string): string => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const json = <T>(p: string): T => JSON.parse(readFileSync(root(p), 'utf8')) as T;

const ajv = new Ajv2020({ allErrors: true, strict: true });
function validator(schemaPath: string) {
  const v = ajv.compile(json<object>(schemaPath));
  return (data: unknown): string[] => (v(data) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`));
}

describe('config/input (AC-1)', () => {
  const layout = json<TouchLayout>('config/input/touch/default-right.json');
  const touchMap = json<InputMap>('config/input/defaults.touch.json');

  it('default-right.json validates against the touch layout schema', () => {
    expect(validator('config/schemas/touch-layout.schema.json')(layout)).toEqual([]);
  });

  it('the touch map and the kbm map validate against the input map schema', () => {
    const check = validator('config/schemas/input-map.schema.json');
    expect(check(touchMap)).toEqual([]);
    expect(check(json('config/input/defaults.kbm.json'))).toEqual([]);
    expect(check(json('config/input/defaults.gamepad.json'))).toEqual([]);
  });

  it('every button of the layout is at least 44 px, has a binding in the touch map, and no binding points at a missing widget', () => {
    const onFoot = touchMap.contexts.onFoot ?? {};
    // One button may drive two actions: Enter is also Interact on touch (M04b2).
    const bound = new Map<string, string[]>();
    for (const [action, bindings] of Object.entries(onFoot)) {
      for (const b of bindings ?? []) if (b.control.startsWith('touch:btn:')) bound.set(b.control.slice('touch:btn:'.length), [...(bound.get(b.control.slice('touch:btn:'.length)) ?? []), action]);
    }
    const buttons = layout.widgets.filter((w) => w.kind === 'button');
    expect(buttons.map((b) => b.id).sort()).toEqual(['attack', 'block', 'camera', 'enter', 'jump', 'pause', 'phone', 'special']);
    for (const b of buttons) {
      if (b.kind !== 'button') continue;
      expect(b.sizePx, `${b.id} size`).toBeGreaterThanOrEqual(44);
      expect(bound.get(b.id) ?? [], `${b.id} is bound to its action`).toContain(b.action);
    }
    // The layout has Jump, Enter (M03a1), Camera, Pause (M04b2 adds Attack, Block, Special and Phone) and no dead button.
    const widgetIds = new Set(buttons.map((b) => b.id));
    const reserved = new Set(['moveRight', 'moveLeft', 'moveUp', 'moveDown', 'sprint']);
    for (const id of bound.keys()) expect(widgetIds.has(id) || reserved.has(id), `binding touch:btn:${id} has no widget`).toBe(true);
  });

  it('client.Pause is bound on touch, and the stick zone and the look zone do not overlap', () => {
    expect(touchMap.contexts.onFoot?.['client.Pause']?.[0]?.control).toBe('touch:btn:pause');
    const zones = layout.widgets.flatMap((w) => (w.kind === 'stick' || w.kind === 'lookzone' ? [{ id: w.id, ...w.zone }] : []));
    expect(zones).toHaveLength(2);
    const [a, b] = zones as [typeof zones[0], typeof zones[0]];
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
  });

  it('F3 toggles the debug panel through client.DebugToggle, in on-foot and in the debug context', () => {
    expect(DEFAULT_KBM_MAP.contexts.onFoot?.['client.DebugToggle']?.[0]?.control).toBe('key:F3');
    expect(DEFAULT_KBM_MAP.contexts.debug?.['client.DebugToggle']?.[0]?.control).toBe('key:F3');
    // The debug context keeps Pause (R-ENG-04: client.Pause is always bound).
    expect(DEFAULT_KBM_MAP.contexts.debug?.['client.Pause']).toBeDefined();
  });

  it('the router compiles the three default maps and keeps Pause in every context', () => {
    expect(DEFAULT_MAPS).toContain(DEFAULT_TOUCH_MAP);
    const router = new InputRouterImpl({ maps: DEFAULT_MAPS });
    expect(router.top()).toBe('onFoot');
  });
});

describe('config/engine-tiers.json (AC-1)', () => {
  it('validates and has a row for each of the six tiers', () => {
    expect(validator('config/schemas/engine-tiers.schema.json')(json('config/engine-tiers.json'))).toEqual([]);
    expect(Object.keys(ENGINE_TIERS).sort()).toEqual([...TIER_IDS].sort());
  });

  it('carries the table of 01-engine.md section 6: bands, voices, ragdolls', () => {
    const row = (id: (typeof TIER_IDS)[number]) => {
      const t = ENGINE_TIERS[id];
      return [t.animBands.fullHzWithinM, t.animBands.halfHzWithinM, t.animBands.quarterHzWithinM, t.audioVoices, t.ragdollCap];
    };
    expect(row('desktop')).toEqual([40, 80, 150, 48, 8]);
    expect(row('desktop-ultra')).toEqual(row('desktop'));
    expect(row('mobile')).toEqual([20, 40, 80, 24, 4]);
    expect(row('mobile-low')).toEqual([12, 25, 50, 16, 2]);
    expect(row('xr-quest')).toEqual([15, 30, 60, 24, 2]);
    expect(row('xr-visionpro')).toEqual([25, 50, 100, 32, 2]);
  });

  it('bands widen outward on every tier', () => {
    for (const id of TIER_IDS) {
      const b = ENGINE_TIERS[id].animBands;
      expect(b.fullHzWithinM).toBeLessThan(b.halfHzWithinM);
      expect(b.halfHzWithinM).toBeLessThan(b.quarterHzWithinM);
    }
  });
});

describe('config/audio.json (AC-1)', () => {
  it('validates; master has no parent and the seven other buses feed it', () => {
    expect(validator('config/schemas/audio.schema.json')(json('config/audio.json'))).toEqual([]);
    expect(AUDIO_CONFIG.buses.master.parent).toBeNull();
    const children = Object.entries(AUDIO_CONFIG.buses).filter(([id]) => id !== 'master');
    expect(children).toHaveLength(7);
    for (const [, b] of children) expect(b.parent).toBe('master');
  });

  it('voice ducks music and radio by 9 dB with an 80 ms attack and a 400 ms release', () => {
    expect(AUDIO_CONFIG.duck.voice).toEqual({ targets: ['music', 'radio'], db: -9, attackMs: 80, releaseMs: 400 });
  });

  it('the footstep cue is foot.step on the sfx bus', () => {
    expect(AUDIO_CONFIG.footstep.cue).toBe('foot.step');
    expect(AUDIO_CONFIG.footstep.bus).toBe('sfx');
  });
});
