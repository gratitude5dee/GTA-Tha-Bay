/**
 * M04e5 guard: the trainer-derived wording stays out of the tree and the build. Every guarded phrase is built at run time
 * from config/ip-denylist.json, so this file holds none of them and itself passes `ip:strings`.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTROL_REASON, CONTROL_REASON_EN } from '../../../packages/engine/src/sim/control/states.ts';
import { compileStringMatcher, normalizeName, scanText, type IpDenylistConfig } from '../../../packages/shared/src/index.ts';
import { STATUS } from '../../../packages/ui/src/hud/model.ts';
import { runIpScan } from '../ip-scan.ts';
import { toolsRoot } from '../lib/common.ts';

const read = (rel: string): string => readFileSync(path.join(toolsRoot, rel), 'utf8');
const deny = JSON.parse(read('config/ip-denylist.json')) as IpDenylistConfig;
const en = JSON.parse(read('content/ui/i18n/en.json')) as Record<string, string>;
const IDS = ['trainer-status', 'trainer-heat', 'trainer-menu'] as const;

/** The phrase alternatives of one pattern, each as its list of words. */
function alternatives(id: string): string[][] {
  const p = deny.patterns.find((x) => x.id === id);
  if (!p) throw new Error(`pattern ${id} missing`);
  const m = /^\\b\(\?:(.*)\)\\b$/.exec(p.regex);
  if (!m || !m[1]) throw new Error(`pattern ${id} is not \\b(?:a|b)\\b`);
  return m[1].split('|').map((alt) => alt.split('\\s+'));
}

let base: string;
beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'dv-trainer-'));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
let counter = 0;
function tempRoot(): string {
  const root = path.join(base, `r${counter++}`);
  mkdirSync(root, { recursive: true });
  cpSync(path.join(toolsRoot, 'config'), path.join(root, 'config'), { recursive: true });
  return root;
}
function put(root: string, rel: string, data: string): void {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
}

describe('config/ip-denylist.json trainer patterns (M04e5)', () => {
  it('has the three pattern ids, case-insensitive, each a list of phrase alternatives', () => {
    for (const id of IDS) {
      const p = deny.patterns.find((x) => x.id === id);
      expect(p, id).toBeDefined();
      expect(p?.flags).toBe('i');
      const alts = alternatives(id);
      expect(alts.length, id).toBeGreaterThan(0);
      for (const w of alts.flat()) expect(w, id).toMatch(/^[a-z]+$/);
    }
    console.log(`guard patterns: ${IDS.join(', ')}`);
  });
});

describe('new English wording (AC-2)', () => {
  const MSG = 'That part of the city is still on its way. Try again in a moment.';
  const expected: Record<string, string> = {
    'world.teleport.notLoaded': MSG,
    'hud.heat.label': 'Heat',
    'hud.heat.wanted': 'Pursued',
    'phone.sandbox.heat': 'Heat',
    'phone.sandbox.heat1': 'Heat 1',
    'phone.sandbox.heat2': 'Heat 2',
    'phone.sandbox.heat3': 'Heat 3',
    'phone.sandbox.heat4': 'Heat 4',
    'phone.sandbox.heat5': 'Heat 5',
    'phone.sandbox.neverOn': 'Heat lock: on',
    'phone.sandbox.neverOff': 'Heat lock: off',
  };

  it('the eleven keys hold the exact values', () => {
    for (const [k, v] of Object.entries(expected)) expect(en[k], k).toBe(v);
  });

  it('the control-reason default equals the catalog value', () => {
    expect(CONTROL_REASON_EN[CONTROL_REASON.groundNotLoaded]).toBe(en['world.teleport.notLoaded']);
  });

  it('no catalog value hits a trainer pattern', () => {
    const matcher = compileStringMatcher(deny);
    for (const [k, v] of Object.entries(en)) {
      expect(scanText(v, matcher).filter((h) => h.rule.startsWith('str-pattern:trainer-')), k).toEqual([]);
    }
  });

  it('no catalog value uses the bare heat word or star counts', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(/\bwanted\b/i.test(v), k).toBe(false);
      expect(/\bstars?\b/i.test(v), k).toBe(false);
    }
  });

  it('heat bars replace the star glyphs', () => {
    // BD-FIX-GLYPH-01: the bars and the two heat icons are the kit's inline SVGs; the U+25AE/U+25AF characters the milestone named
    // rendered as .notdef boxes on staging, so neither they nor the star glyphs appear in the HUD sources.
    expect(STATUS['heat.clear']?.icon).toBe('shield');
    expect(STATUS['heat.wanted']?.icon).toBe('siren');
    expect(read('packages/ui/src/hud/widgets.tsx')).toContain('<HeatBar ');
    for (const f of ['packages/ui/src/hud/model.ts', 'packages/ui/src/hud/widgets.tsx']) {
      const text = read(f);
      for (const ch of ['★', '☆', '▮', '▯']) expect(text.includes(ch), `${f} ${ch}`).toBe(false);
    }
  });
});

describe('ip:strings applies the trainer patterns (AC-3)', () => {
  const variants = (words: string[]): string[] => [
    words.join(' '),
    words.join(' ').toUpperCase(),
    words.map((w, i) => (i % 2 ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1))).join(' '),
    words.join('\n'),
  ];

  for (const id of IDS) {
    it(`reports every ${id} alternative in a source file, in any case and across a line break`, () => {
      const root = tempRoot();
      const expectedFiles = new Set<string>();
      alternatives(id).forEach((words, a) => {
        variants(words).forEach((text, v) => {
          const rel = `packages/ui/src/${id}-${a}-${v}.ts`;
          put(root, rel, `export const s = \`${text}\`;\n`);
          expectedFiles.add(rel);
        });
      });
      const res = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] });
      const hit = new Set(res.findings.filter((f) => f.rule === `str-pattern:${id}`).map((f) => f.file));
      expect(hit).toEqual(expectedFiles);
    });
  }

  it('does not report identifiers, the new wording, or the same phrases under spec/ and research/', () => {
    const root = tempRoot();
    const ids = ['neverWanted', 'godMode', 'never-wanted', 'sandbox.status.preparing', 'sandbox.player.neverWanted'];
    put(root, 'packages/ui/src/ids.ts', `export const ids = ${JSON.stringify(ids)};\n`);
    put(root, 'packages/ui/src/new.ts', `export const s = ${JSON.stringify(Object.values(en).filter((v) => /^(Heat|That part|Pursued)/.test(v)))};\n`);
    const phrase = alternatives('trainer-menu')[0]?.join(' ') ?? '';
    put(root, 'spec/x.md', `${phrase}\n`);
    put(root, 'research/x.md', `${phrase}\n`);
    const res = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] });
    expect(res.findings).toEqual([]);
  });
});

describe('other readers of the denylist (AC-6)', () => {
  it('a normalized username never matches a trainer pattern', () => {
    const matcher = compileStringMatcher(deny);
    for (const id of IDS) {
      // a one-word name stays a word after normalizing; the username check covers phrases only
      for (const words of alternatives(id).filter((w) => w.length > 1)) {
        expect(scanText(normalizeName(words.join(' ')), matcher), id).toEqual([]);
      }
    }
  });
});
