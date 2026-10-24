import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_DELTA_E, PALETTE_FOR, SEMANTIC_TOKENS, contrast, minSeparation, separations, simulate, parseHex, toLab, type PaletteId,
} from '../src/hud/cvd.ts';
import {
  HUD_MOTION, MAX_FLASHES_PER_SECOND, PALETTES, PALETTE_IDS, STATUS, clockText, dollars, flashesPerSecond, heatStatus, litStars, paletteVars, promptGlyph, promptTextKey,
} from '../src/hud/model.ts';
import { StatusChip } from '../src/hud/widgets.tsx';
import en from '../../../content/ui/i18n/en.json';
import palettesJson from '../../../config/ui/palettes.json';

const repo = path.resolve(import.meta.dirname, '../../..');
const cat = en as Record<string, string>;

describe('status widgets (AC-5)', () => {
  it('every status carries an icon and a localized text besides its colour', () => {
    expect(Object.keys(STATUS).length).toBeGreaterThanOrEqual(15);
    for (const s of Object.values(STATUS)) {
      expect(s.icon.length, s.id).toBeGreaterThan(0);
      expect(cat[s.textKey], `${s.id} text ${s.textKey}`).toBeTypeOf('string');
      expect(SEMANTIC_TOKENS).toContain(s.tone);
    }
  });

  it('a StatusChip renders the icon and the text, never the colour alone', () => {
    const tree = JSON.stringify(StatusChip({ status: STATUS['danger']! }));
    expect(tree).toContain(STATUS['danger']!.icon);
    expect(tree).toContain('dv-schip-text');
  });

  it('heat: the phase picks the text, the scripted level 6 has its own icon, stars lit are capped at five', () => {
    expect(heatStatus(undefined).id).toBe('heat.clear');
    expect(heatStatus({ level: 2, phase: 'wanted' }).id).toBe('heat.wanted');
    expect(heatStatus({ level: 2, phase: 'searching' }).id).toBe('heat.searching');
    expect(heatStatus({ level: 2, phase: 'cooldown' }).id).toBe('heat.cooldown');
    const scripted = heatStatus({ level: 6, phase: 'wanted' });
    expect(scripted.id).toBe('heat.scripted');
    const icons = new Set(['heat.clear', 'heat.wanted', 'heat.searching', 'heat.cooldown', 'heat.scripted'].map((k) => STATUS[k]!.icon));
    expect(icons.size).toBe(5);
    expect(litStars(6)).toBe(5);
    expect(litStars(-1)).toBe(0);
  });

  it('prompt glyphs follow the active device and a refusal replaces the action text', () => {
    expect(promptGlyph(1, 'kbm')).toBe('F');
    expect(promptGlyph(2, 'kbm')).toBe('E');
    expect(promptGlyph(1, 'gamepad')).toBe('Y');
    expect(promptGlyph(1, 'touch')).toBe('');
    expect(promptTextKey({ key: 'interact.enterVehicle' })).toBe('interact.enterVehicle');
    expect(promptTextKey({ key: 'interact.enterVehicle', reason: 'engine.vehicle.locked' })).toBe('engine.vehicle.locked');
    expect(cat['interact.enterVehicle']).toBeTypeOf('string');
    expect(cat['engine.vehicle.locked']).toBeTypeOf('string');
  });

  it('wallet and clock text', () => {
    expect(dollars(123456)).toBe('$1,234');
    expect(dollars(0)).toBe('$0');
    expect(clockText(7.5)).toBe('07:30');
    expect(clockText(25.25)).toBe('01:15');
  });
});

describe('palettes and the CVD separation check (AC-5)', () => {
  it('the four palettes exist and switching hudPalette changes the semantic tokens', () => {
    expect(PALETTE_IDS).toEqual(['default', 'deutan', 'protan', 'tritan']);
    const base = paletteVars('default');
    for (const id of ['deutan', 'protan', 'tritan'] as const) {
      const v = paletteVars(id);
      const changed = SEMANTIC_TOKENS.filter((tk) => v[`--dv-sem-${tk}`] !== base[`--dv-sem-${tk}`]);
      expect(changed.length, id).toBeGreaterThanOrEqual(2);
    }
    expect(paletteVars('nonsense')).toEqual(base);
    expect(Object.keys(base)).toEqual(SEMANTIC_TOKENS.map((k) => `--dv-sem-${k}`));
  });

  it('the recorded threshold is the one the check uses and every pair of every palette clears it under its own deficiency', () => {
    expect((palettesJson as { cvd: { minDeltaE: number } }).cvd.minDeltaE).toBe(MIN_DELTA_E);
    expect(MIN_DELTA_E).toBe(20);
    for (const id of PALETTE_IDS) {
      const kind = PALETTE_FOR[id as PaletteId];
      const pairs = separations(PALETTES[id as PaletteId], kind);
      expect(pairs).toHaveLength(10);
      for (const p of pairs) expect(p.deltaE, `${id} ${p.a}/${p.b} under ${kind}`).toBeGreaterThanOrEqual(MIN_DELTA_E);
      expect(minSeparation(PALETTES[id as PaletteId], kind)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    }
  });

  it('the simulation is sane: grey is unchanged, red and green collapse under deutan but not under normal vision', () => {
    const grey = simulate(parseHex('#808080'), 'deutan');
    const lin = simulate(parseHex('#808080'), 'normal');
    expect(Math.abs(grey[0] - lin[0])).toBeLessThan(0.01);
    const red = parseHex('#ff0000');
    const green = parseHex('#00aa00');
    const d = (k: 'normal' | 'deutan'): number => {
      const a = toLab(simulate(red, k));
      const b = toLab(simulate(green, k));
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    expect(d('deutan')).toBeLessThan(d('normal'));
  });

  it('semantic colours read on the dark HUD plate (text contrast 4.5:1)', () => {
    for (const id of PALETTE_IDS) for (const tk of SEMANTIC_TOKENS) expect(contrast(PALETTES[id as PaletteId][tk], '#0b1426'), `${id} ${tk}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('flash limit (AC-5)', () => {
  it('no HUD motion token flashes more than three times per second', () => {
    for (const m of HUD_MOTION) expect(flashesPerSecond(m), m.id).toBeLessThanOrEqual(MAX_FLASHES_PER_SECOND);
  });

  it('every infinite CSS animation of the kit cycles slower than 3 Hz, and the stylesheet animations are in the motion table', () => {
    const dir = path.join(repo, 'packages/ui/src/kit');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
      const css = readFileSync(path.join(dir, f), 'utf8');
      for (const m of css.matchAll(/animation:\s*[\w-]+\s+([\d.]+)(m?s)[^;]*infinite/g)) {
        const sec = Number(m[1]) / (m[2] === 'ms' ? 1000 : 1);
        expect(1 / sec, `${f} ${m[0]}`).toBeLessThanOrEqual(MAX_FLASHES_PER_SECOND);
      }
    }
    const hud = readFileSync(path.join(dir, 'm04b2-hud.css'), 'utf8');
    const durations = [...hud.matchAll(/animation:\s*[\w-]+\s+([\d.]+)s/g)].map((m) => Number(m[1]) * 1000);
    for (const d of durations) expect(HUD_MOTION.some((m) => m.periodMs === d), `period ${d} ms is in the table`).toBe(true);
  });

  it('reduced motion switches the blinking off', () => {
    const hud = readFileSync(path.join(repo, 'packages/ui/src/kit/m04b2-hud.css'), 'utf8');
    expect(hud).toContain("[data-reduced-motion='true'] .dv-heat .dv-star-on { animation: none; }");
    expect(hud).toContain('prefers-reduced-motion: reduce');
  });
});
