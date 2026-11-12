import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SCATTER_BIT, TREE_FORM_NAMES, TreeForm, VEG_FORM_NAMES, fallbackForm, formOfOsmTags, formOfSpecies, genusOf, isScatterByte, isUnderstoryForm, readsTreeForms,
  skippedSpecies, speciesMatched, treeByte, treeFormOfByte, triangularQuantile, type TreeFormTable,
} from '../src/index.ts';

/**
 * M02h4 AC-2 (shared half): the form class of the TREE byte. The genus of a botanical name maps through `config/world/tree-forms.json`;
 * the synth species reach their forms; an unknown name takes the hash-keyed split (Plane 0.6, Ficus 0.4); OSM tags read `species`, then
 * `genus`, then `leaf_type=needleleaved`. The table's schema check is `tools/map/test/tree-forms.bake.spec.ts`.
 */
const TABLE = JSON.parse(readFileSync(new URL('../../../config/world/tree-forms.json', import.meta.url), 'utf8')) as TreeFormTable;

describe('tree form class (AC-2)', () => {
  it('the genus is the lowercased first word of the botanical name', () => {
    expect(genusOf('Platanus x hispanica :: London Plane')).toBe('platanus');
    expect(genusOf('  Phoenix canariensis')).toBe('phoenix');
    expect(genusOf("Parrotia persica 'Vannessa'")).toBe('parrotia');
    expect(genusOf('Tree(s) ::')).toBe('tree');
    expect(genusOf('::')).toBe('');
  });

  it('the milestone rows map to their forms', () => {
    const rows: [string, TreeForm][] = [
      ['platanus', TreeForm.Plane], ['ficus', TreeForm.Ficus], ['cupressus', TreeForm.Conifer], ['pinus', TreeForm.Conifer], ['sequoia', TreeForm.Conifer],
      ['eucalyptus', TreeForm.Eucalyptus], ['phoenix', TreeForm.Palm], ['washingtonia', TreeForm.Palm], ['syagrus', TreeForm.Palm],
    ];
    for (const [g, f] of rows) expect(formOfSpecies(`${g[0]!.toUpperCase()}${g.slice(1)} something :: Common`, TABLE), g).toBe(f);
  });

  it('the synth species map to their forms; all five forms are among them', () => {
    const synth: [string, TreeForm][] = [
      ['Platanus x hispanica', TreeForm.Plane], ['Tristaniopsis laurina', TreeForm.Ficus], ['Prunus cerasifera', TreeForm.Ficus], ['Ficus microcarpa', TreeForm.Ficus],
      ['Metrosideros excelsa', TreeForm.Ficus], ['Pyrus calleryana', TreeForm.Ficus], ['Phoenix canariensis', TreeForm.Palm], ['Cupressus macrocarpa', TreeForm.Conifer],
      ['Eucalyptus globulus', TreeForm.Eucalyptus],
    ];
    for (const [name, f] of synth) {
      expect(formOfSpecies(name, TABLE), name).toBe(f);
      expect(speciesMatched(name, TABLE)).toBe(true);
    }
    expect(new Set(synth.map(([, f]) => f)).size).toBe(5);
  });

  it('unknown names take the hash split, stable per name, near 0.6 Plane over many names', () => {
    let plane = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const name = `Unknownus species${i} :: Nothing`;
      expect(speciesMatched(name, TABLE)).toBe(false);
      const f = formOfSpecies(name, TABLE);
      expect(f === TreeForm.Plane || f === TreeForm.Ficus).toBe(true);
      expect(formOfSpecies(name, TABLE)).toBe(f);
      if (f === TreeForm.Plane) plane++;
    }
    expect(plane / n).toBeGreaterThan(0.55);
    expect(plane / n).toBeLessThan(0.65);
    const all: TreeFormTable = { ...TABLE, fallback: { planeShare: 1 } };
    expect(fallbackForm('anything', all)).toBe(TreeForm.Plane);
    const none: TreeFormTable = { ...TABLE, fallback: { planeShare: 0 } };
    expect(fallbackForm('anything', none)).toBe(TreeForm.Ficus);
  });

  it('OSM: species, then genus, then needleleaved; nothing matched takes the split', () => {
    expect(formOfOsmTags({ species: 'Phoenix canariensis' }, TABLE, 'n1').form).toBe(TreeForm.Palm);
    expect(formOfOsmTags({ species: 'Nothingus x', genus: 'Pinus' }, TABLE, 'n2')).toMatchObject({ form: TreeForm.Conifer, matched: true });
    expect(formOfOsmTags({ leaf_type: 'needleleaved' }, TABLE, 'n3')).toMatchObject({ form: TreeForm.Conifer, matched: true });
    const r = formOfOsmTags({}, TABLE, 'n4');
    expect(r.matched).toBe(false);
    expect([TreeForm.Plane, TreeForm.Ficus]).toContain(r.form);
  });

  it('the byte: the low seven bits are the form (0..6, M02h5 Shrub 5 and Hedge 6), bit 7 the scatter flag; C08 1.1 indexes carry forms', () => {
    expect(TREE_FORM_NAMES).toEqual(['plane', 'ficus', 'conifer', 'eucalyptus', 'palm']);
    expect(VEG_FORM_NAMES).toEqual(['plane', 'ficus', 'conifer', 'eucalyptus', 'palm', 'shrub', 'hedge']);
    expect([TreeForm.Shrub, TreeForm.Hedge, SCATTER_BIT]).toEqual([5, 6, 128]);
    for (let b = 0; b < 256; b++) {
      const low = b & 0x7f;
      expect(treeFormOfByte(b), `byte ${b}`).toBe(low <= 6 ? low : TreeForm.Plane);
      expect(isScatterByte(b)).toBe(b >= 128);
    }
    for (const b of [-1, 256, 1.5, Number.NaN]) {
      expect(treeFormOfByte(b)).toBe(TreeForm.Plane);
      expect(isScatterByte(b)).toBe(false);
    }
    for (let f = 0; f <= 6; f++) {
      expect(treeByte(f as TreeForm, false)).toBe(f);
      expect(treeByte(f as TreeForm, true)).toBe(f + 128);
      expect(treeFormOfByte(treeByte(f as TreeForm, true))).toBe(f);
      expect(isUnderstoryForm(f as TreeForm)).toBe(f === 5 || f === 6);
    }
    expect(readsTreeForms('1.1.0')).toBe(true);
    expect(readsTreeForms('1.0.0')).toBe(false);
    expect(readsTreeForms('2.0.0')).toBe(true);
  });

  it('M02h5: skipSpecies drops planting sites and stumps by genus or whole name, never a tree; shrub and hedge have height rows', () => {
    expect(TABLE.skipSpecies).toEqual(['planting', 'stump']);
    for (const n of ['Planting site (plant) :: Planting Site (plant)', 'Stump (use Grinder) :: Stump (use Grinder)', 'Stump :: Stump']) expect(skippedSpecies(n, TABLE), n).toBe(true);
    for (const n of ['Tree(s) ::', 'Platanus x hispanica', 'unknown', '::', 'Shrub :: Shrub']) expect(skippedSpecies(n, TABLE), n).toBe(false);
    expect(skippedSpecies('Stump', { ...TABLE, skipSpecies: [] })).toBe(false);
    const { skipSpecies: _s, ...noList } = TABLE;
    expect(skippedSpecies('Stump', noList as TreeFormTable)).toBe(false);
    expect(TABLE.forms.shrub?.heightM).toEqual([0.6, 1.2, 2.5]);
    expect(TABLE.forms.hedge?.heightM).toEqual([0.9, 1.4, 2.2]);
  });

  it('the triangular quantile ends at min and max and passes the mode', () => {
    expect(triangularQuantile(0, 6, 10, 16)).toBe(6);
    expect(triangularQuantile(1, 6, 10, 16)).toBe(16);
    expect(triangularQuantile(0.4, 6, 10, 16)).toBeCloseTo(10, 9);
    expect(triangularQuantile(0.5, 5, 5, 5)).toBe(5);
  });
});
