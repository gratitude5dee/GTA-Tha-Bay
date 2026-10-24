/**
 * AC-11 (static half): the racing touch layout validates against the S10 layout schema, every button is at least 44 px and has
 * a binding in the `vehicle` context of the touch map, and a `steer` stick writes only the horizontal half-axes.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { TouchBinder, type TouchLayout } from '../../../engine/src/client/input/touch.ts';

const json = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8')) as T;
const layout = json<TouchLayout>('config/input/touch/vehicle-racing.json');
const touchMap = json<{ contexts: Record<string, Record<string, { control: string }[]>> }>('config/input/defaults.touch.json');

describe('racing touch layout', () => {
  it('validates against the touch layout schema', () => {
    const v = new Ajv2020({ allErrors: true, strict: true }).compile(json<object>('config/schemas/touch-layout.schema.json'));
    expect(v(layout), JSON.stringify(v.errors)).toBe(true);
    expect(layout.context).toBe('vehicle');
  });

  it('has pedals, a steer arc, nitro, handbrake, reset and look-behind; each button is 44 px or more and bound in the vehicle context', () => {
    const buttons = layout.widgets.flatMap((w) => (w.kind === 'button' ? [w] : []));
    expect(buttons.map((b) => b.id).sort()).toEqual(['behind', 'brake', 'gas', 'handbrake', 'nitro', 'pause', 'reset']);
    expect(layout.widgets.some((w) => w.kind === 'stick' && w.role === 'steer')).toBe(true);
    const ctx = touchMap.contexts['vehicle'] ?? {};
    for (const b of buttons) {
      expect(b.sizePx, `${b.id} size`).toBeGreaterThanOrEqual(44);
      expect((ctx[b.action] ?? []).some((x) => x.control === `touch:btn:${b.id}`), `${b.id} is bound to ${b.action}`).toBe(true);
    }
  });

  it('a steer stick writes the horizontal half-axes only, whatever the vertical drag', () => {
    const t = 0;
    const binder = new TouchBinder({ layout, viewport: () => ({ w: 844, h: 390 }), now: () => t });
    const handlers = new Map<string, (e: unknown) => void>();
    binder.attach({ addEventListener: (n: string, f: (e: unknown) => void) => handlers.set(n, f), removeEventListener() {} } as never);
    const ev = (clientX: number, clientY: number) => ({ pointerId: 1, pointerType: 'touch', clientX, clientY, target: null });
    handlers.get('pointerdown')?.(ev(100, 250));
    handlers.get('pointermove')?.(ev(140, 330));
    const raw = { controls: new Map<string, number>(), latchedPress: new Set<string>(), lookDelta: [0, 0], lastActiveDevice: 'kbm' };
    binder.poll(raw as never, 1000);
    expect(raw.controls.get('touch:btn:moveRight')).toBeGreaterThan(0.5);
    expect(raw.controls.has('touch:btn:moveDown')).toBe(false);
    expect(raw.controls.has('touch:btn:moveUp')).toBe(false);
  });
});
