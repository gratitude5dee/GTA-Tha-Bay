/**
 * BD-FIX-GLYPH-01: the HUD heat row read "▯▯▯▯▯" and the Clear chip showed a box on staging. The app ships no font, so every HUD icon
 * that was a symbol character (U+25AF, U+25AE, U+26D4 and the rest) came from whatever system font the browser had, and the white
 * rectangle U+25AF is indistinguishable from the .notdef box even where it exists. HUD icons are now the kit's inline SVGs. These checks
 * render the widgets as plain vnode trees (no DOM) and scan the HUD sources, so a symbol glyph cannot come back.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { ICONS, ICON_IDS, Icon } from '../src/kit/icons.tsx';
import { STATUS } from '../src/hud/model.ts';
import { HeatStars, MeterBar, StatusChip } from '../src/hud/widgets.tsx';

const repo = path.resolve(import.meta.dirname, '../../..');

/** Characters every system UI font on the target browsers covers: printable ASCII and Latin-1 (macOS, iOS, Android/Quest, Windows). */
const SAFE = /^[ -~ -ÿ]*$/u;

interface Out { text: string[]; nodes: { type: string; props: Record<string, unknown> }[] }

/** Expands function components (the HUD widgets used here have no hooks) and collects text and host elements. */
function expand(node: unknown, out: Out = { text: [], nodes: [] }): Out {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) expand(n, out);
    return out;
  }
  const v = node as VNode<Record<string, unknown>>;
  if (typeof v.type === 'function') return expand((v.type as (p: unknown) => unknown)(v.props), out);
  out.nodes.push({ type: String(v.type), props: v.props });
  return expand(v.props.children, out);
}

const iconsIn = (o: Out): string[] => o.nodes.filter((n) => n.type === 'svg').map((n) => String(n.props['data-icon']));

describe('HUD icons are inline SVG, never font glyphs (BD-FIX-GLYPH-01)', () => {
  it('every status names a kit icon, and every kit icon is non-empty path data', () => {
    for (const s of Object.values(STATUS)) expect(ICON_IDS, s.id).toContain(s.icon);
    for (const id of ICON_IDS) {
      expect(ICONS[id].length, id).toBeGreaterThan(0);
      for (const p of ICONS[id]) expect(p.d, id).toMatch(/^M[\d .,a-zA-Z-]+$/);
    }
  });

  it('the heat row at level 0 renders five SVG bars and a Clear chip with an SVG icon, and no symbol text', () => {
    const o = expand(HeatStars({ heat: { level: 0, phase: 'clear', cooldown: 0, units: 0, seen: false } }));
    const icons = iconsIn(o);
    expect(icons.filter((i) => i === 'heat-bar')).toHaveLength(5);
    expect(icons).toContain('shield');
    for (const s of o.text) expect(s, JSON.stringify(s)).toMatch(SAFE);
  });

  it('every heat level and phase, the scripted 6 included, renders only SVG icons and safe text', () => {
    for (const phase of ['wanted', 'searching', 'cooldown'])
      for (let level = 0; level <= 6; level++) {
        const o = expand(HeatStars({ heat: { level, phase, cooldown: 0.5, units: 1, seen: true } }));
        expect(iconsIn(o).filter((i) => i === 'heat-bar')).toHaveLength(5);
        if (level >= 6) expect(iconsIn(o)).toContain('spark');
        for (const s of o.text) expect(s, `${phase} ${level} ${JSON.stringify(s)}`).toMatch(SAFE);
      }
  });

  it('every status chip and the meter bar render an SVG icon and no symbol text', () => {
    for (const s of Object.values(STATUS)) {
      const o = expand(StatusChip({ status: s, label: 'x' }));
      expect(iconsIn(o), s.id).toEqual([s.icon]);
      for (const txt of o.text) expect(txt, s.id).toMatch(SAFE);
    }
    const m = expand(MeterBar({ id: 'health', label: 'Health', value: 50, max: 100, icon: 'heart' }));
    expect(iconsIn(m)).toEqual(['heart']);
    for (const txt of m.text) expect(txt).toMatch(SAFE);
  });

  it('an icon is decorative: aria-hidden, not focusable, painted in currentColor', () => {
    const o = expand(Icon({ name: 'shield' }));
    const svg = o.nodes.find((n) => n.type === 'svg');
    expect(svg?.props['aria-hidden']).toBe('true');
    expect(svg?.props['focusable']).toBe('false');
    for (const p of o.nodes.filter((n) => n.type === 'path')) expect([p.props['fill'], p.props['stroke']]).toContain('currentColor');
  });

  it('no HUD source puts a symbol character in a string or JSX text (comments aside)', () => {
    const dir = path.join(repo, 'packages/ui/src/hud');
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      src.split('\n').forEach((line, i) => expect(line, `${f}:${i + 1}`).toMatch(SAFE));
    }
  });
});
