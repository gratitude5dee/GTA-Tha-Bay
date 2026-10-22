import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS, CUSTOM_SLOTS, MIN_SPACING_PX, MIN_TARGET_PX, REQUIRED_ONFOOT, SHIPPED_IDS, SHIPPED_LAYOUTS, asCustom, editButton, layoutChoices, nextCustomSlot,
  outOfReach, reachOf, resolveLayout, setOpacity, validateLayout, type ButtonWidget, type Fixture,
} from '../src/hud/touch.ts';
import fixture from './fixtures/iphone-landscape.json';
import defaultsTouch from '../../../config/input/defaults.touch.json';

const repo = path.resolve(import.meta.dirname, '../../..');
const schema = JSON.parse(readFileSync(path.join(repo, 'packages/shared/schemas/ui/touch-layout.v1.schema.json'), 'utf8')) as Record<string, unknown>;
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const fx = fixture as Fixture;

describe('shipped touch layouts (AC-3)', () => {
  it('ships exactly the four layouts and each validates against the schema', () => {
    expect(SHIPPED_IDS).toEqual(['default-right', 'default-left', 'compact', 'one-handed']);
    for (const id of SHIPPED_IDS) {
      const l = SHIPPED_LAYOUTS[id]!;
      expect(l.id).toBe(id);
      expect(validate(l), `${id} ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('every widget lies inside the safe area of the fixture, targets are at least 44 px with at least 8 px between them, every ActionId exists', () => {
    for (const id of SHIPPED_IDS) {
      const problems = validateLayout(SHIPPED_LAYOUTS[id]!, fx);
      expect(problems, `${id}: ${JSON.stringify(problems)}`).toEqual([]);
      for (const w of SHIPPED_LAYOUTS[id]!.widgets) {
        if (w.kind === 'button') {
          expect(w.sizePx, `${id}/${w.id}`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
          expect(ACTION_IDS.has(w.action), `${id}/${w.id} ${w.action}`).toBe(true);
        }
      }
    }
    expect(MIN_SPACING_PX).toBe(8);
  });

  it('every layout offers the required on-foot actions, and one-handed reaches all of its buttons with one thumb', () => {
    for (const id of SHIPPED_IDS) {
      const have = new Set(SHIPPED_LAYOUTS[id]!.widgets.filter((w): w is ButtonWidget => w.kind === 'button').map((w) => w.action));
      for (const a of REQUIRED_ONFOOT) expect(have.has(a), `${id} has ${a}`).toBe(true);
    }
    expect(outOfReach(SHIPPED_LAYOUTS['one-handed']!, fx)).toEqual([]);
    const far = SHIPPED_LAYOUTS['default-right']!.widgets.filter((w): w is ButtonWidget => w.kind === 'button').map((w) => reachOf(w, fx));
    expect(Math.max(...far)).toBeGreaterThan(0);
  });

  it('default-left mirrors default-right and the stick sits on the opposite side', () => {
    const r = SHIPPED_LAYOUTS['default-right']!;
    const l = SHIPPED_LAYOUTS['default-left']!;
    expect(l.handed).toBe('left');
    const stickR = r.widgets.find((w) => w.kind === 'stick')!;
    const stickL = l.widgets.find((w) => w.kind === 'stick')!;
    expect((stickR as { zone: { x: number } }).zone.x).toBeLessThan(0.5);
    expect((stickL as { zone: { x: number } }).zone.x).toBeGreaterThan(0.4);
    expect(l.widgets.filter((w) => w.kind === 'button').every((w) => (w as ButtonWidget).at.corner[1] === 'l')).toBe(true);
  });

  it('every button id is bound by the touch input map, so a press reaches the game', () => {
    const bound = new Set<string>();
    for (const ctx of Object.values(defaultsTouch.contexts)) for (const list of Object.values(ctx as Record<string, { control: string }[]>)) for (const b of list) bound.add(b.control);
    for (const id of SHIPPED_IDS) {
      for (const w of SHIPPED_LAYOUTS[id]!.widgets) if (w.kind === 'button') expect(bound.has(`touch:btn:${w.id}`), `${id}/${w.id}`).toBe(true);
    }
  });
});

describe('layout resolution and editing', () => {
  it('a missing, unknown or broken custom layout falls back to default-right', () => {
    expect(resolveLayout(undefined, {}).id).toBe('default-right');
    expect(resolveLayout('nope', {}).id).toBe('default-right');
    expect(resolveLayout('custom:2', {}).id).toBe('default-right');
    expect(resolveLayout('custom:2', { 'custom:2': { v: 2 } }).id).toBe('default-right');
    expect(resolveLayout('compact', {}).id).toBe('compact');
  });

  it('an edited layout saved as custom:1 resolves back, snaps to 8 px and keeps sizes in 40 to 96', () => {
    const base = SHIPPED_LAYOUTS['default-right']!;
    let l = editButton(base, 'jump', { dx: 31, dy: 45, sizePx: 200 });
    const jump = l.widgets.find((w) => w.id === 'jump') as ButtonWidget;
    expect(jump.at.dx % 8).toBe(0);
    expect(jump.at.dy % 8).toBe(0);
    expect(jump.sizePx).toBe(96);
    l = setOpacity(l, 0.05);
    expect(l.opacity).toBe(0.2);
    const custom = asCustom(l, nextCustomSlot({}));
    expect(custom.id).toBe('custom:1');
    expect(validate(custom), JSON.stringify(validate.errors)).toBe(true);
    const back = resolveLayout('custom:1', { 'custom:1': custom as never });
    expect(back).toEqual(custom);
    expect(layoutChoices({ 'custom:1': custom })).toEqual([...SHIPPED_IDS, 'custom:1']);
    expect(nextCustomSlot({ 'custom:1': 1, 'custom:2': 1, 'custom:3': 1, 'custom:4': 1 })).toBe(1);
    expect(CUSTOM_SLOTS).toBe(4);
  });

  it('the validator reports overlaps, small targets and unknown actions', () => {
    const l = structuredClone(SHIPPED_LAYOUTS['default-right']!);
    const jump = l.widgets.find((w) => w.id === 'jump') as ButtonWidget;
    jump.sizePx = 30;
    (l.widgets.find((w) => w.id === 'attack') as ButtonWidget).at.dx = 30;
    (l.widgets.find((w) => w.id === 'block') as ButtonWidget).action = 'sim.Nope' as never;
    const kinds = validateLayout(l, fx).map((p) => p.kind);
    expect(kinds).toContain('size');
    expect(kinds).toContain('overlap');
    expect(kinds).toContain('action');
  });
});
