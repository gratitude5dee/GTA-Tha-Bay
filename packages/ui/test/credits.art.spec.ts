/**
 * M10d0 AC-9: the Art section of the credits page shows a courtesy line per CC0 pack and, for a CC-BY entry, its title, author, source,
 * licence with a working link, and the change note; the catalog has the keys; an entry that lacks a field or has a link that is not
 * https is left out. The component is a plain function of its props, so its element tree is read directly (no DOM).
 */
import { describe, expect, it } from 'vitest';
import type { ArtCredit } from '@dv/shared';
import en from '../../../content/ui/i18n/en.json';
import { registerTexts } from '../src/i18n/index.ts';
import { ArtCreditsSection, isArtCredit } from '../src/pages/system.tsx';

registerTexts(en as Record<string, string>);

interface Node { type?: unknown; props?: { children?: unknown; [k: string]: unknown } }

/** Every element below `n`, depth first. */
function elements(n: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(n)) {
    for (const c of n) elements(c, out);
    return out;
  }
  if (n && typeof n === 'object') {
    const node = n as Node;
    out.push(node);
    elements(node.props?.children, out);
  }
  return out;
}

/** The text of `n` with its children. */
function text(n: unknown): string {
  if (Array.isArray(n)) return n.map(text).join('');
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (n && typeof n === 'object') return text((n as Node).props?.children);
  return '';
}

const COURTESY: ArtCredit = { pack: 'polyhaven', courtesy: 'Textures from Poly Haven (polyhaven.com), licensed under CC0 1.0 Universal.' };
const CCBY: ArtCredit = {
  pack: 'ccby-fixture',
  title: 'Weathered Wall',
  author: 'Jane Doe',
  sourceUrl: 'https://example.org/items/1',
  licence: 'CC-BY-4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'resized to 1024 px and encoded as KTX2',
};

describe('ArtCreditsSection', () => {
  it('shows nothing without entries', () => {
    expect(ArtCreditsSection({ art: [] })).toBeNull();
  });

  it('shows the courtesy line and the five fields of a CC-BY entry with links that go to its source and licence', () => {
    const tree = ArtCreditsSection({ art: [COURTESY, CCBY] });
    const nodes = elements(tree);
    const byId = (id: string): Node | undefined => nodes.find((n) => n.props?.['data-testid'] === id);
    expect(text(byId('credit-art-polyhaven'))).toBe((COURTESY as { courtesy: string }).courtesy);
    const row = text(byId('credit-art-ccby-fixture-1'));
    for (const field of ['Weathered Wall', 'Jane Doe', 'CC-BY-4.0', 'resized to 1024 px and encoded as KTX2']) expect(row).toContain(field);
    expect(row).toContain('Source');
    expect(row).toContain('Changes');
    expect(byId('credit-art-source')?.props?.['href']).toBe('https://example.org/items/1');
    const licence = byId('credit-art-licence');
    expect(licence?.props?.['href']).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(licence?.props?.['rel']).toBe('noreferrer noopener');
    expect(text(nodes.find((n) => n.type === 'h2'))).toBe('Art');
  });

  it('lists a courtesy line per pack and the entries in the order given', () => {
    const tree = ArtCreditsSection({ art: [COURTESY, { pack: 'ambientcg', courtesy: 'Created using materials from ambientCG.com, licensed under CC0 1.0.' }] });
    const items = elements(tree).filter((n) => n.type === 'li');
    expect(items.map((n) => n.props?.['data-testid'])).toEqual(['credit-art-polyhaven', 'credit-art-ambientcg']);
  });
});

describe('isArtCredit', () => {
  it('accepts a courtesy line and a complete CC-BY entry', () => {
    expect(isArtCredit(COURTESY)).toBe(true);
    expect(isArtCredit(CCBY)).toBe(true);
  });

  it('leaves out an entry that lacks a field or links somewhere that is not https', () => {
    expect(isArtCredit({ ...CCBY, changes: '' })).toBe(false);
    expect(isArtCredit({ ...CCBY, author: undefined })).toBe(false);
    expect(isArtCredit({ ...CCBY, licenceUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isArtCredit({ ...CCBY, sourceUrl: 'http://example.org/' })).toBe(false);
    expect(isArtCredit({ pack: 'x', courtesy: '' })).toBe(false);
    expect(isArtCredit(null)).toBe(false);
    expect(isArtCredit('x')).toBe(false);
  });
});

describe('credits.art catalog keys', () => {
  it('has the section title and labels', () => {
    for (const k of ['credits.art', 'credits.art.body', 'credits.art.by', 'credits.art.source', 'credits.art.changes']) {
      expect((en as Record<string, string>)[k], k).toBeTypeOf('string');
    }
  });
});
