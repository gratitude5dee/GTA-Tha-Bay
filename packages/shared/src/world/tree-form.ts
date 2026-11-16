// packages/shared/src/world/tree-form.ts — the tree form class of C08 1.1 (DL-741; M02h4). Pure: no IO, no other package (C02 lint applies).
//
// Record 22 TREE `u8 species` and the species lane of `RenderChunk.trees` hold a `TreeForm` when `WorldIndex.c08` is 1.1 or later: the
// bake (S3) maps a botanical name to one of five original procedural forms, and the client meshes the form, never the name. A 1.0 index
// keeps the old meaning (a species hash 0..7), which the client meshes as `Plane`. M02h5 adds `Shrub` 5 and `Hedge` 6 and bit 7, the
// scatter flag (a record S13's scatter placed, never a street tree): the low seven bits are the form; 7–127 are reserved and mesh as `Plane`.
import type { AssetRef } from '../assets/c07.ts';
import { dsqrt } from '../detmath.ts';
import { fnv32 } from '../hash.ts';

export const TreeForm = { Plane: 0, Ficus: 1, Conifer: 2, Eucalyptus: 3, Palm: 4, Shrub: 5, Hedge: 6 } as const;
export type TreeForm = (typeof TreeForm)[keyof typeof TreeForm];
/** The tree forms of M02h4 in byte order (a street tree is always one of these). */
export const TREE_FORMS: readonly TreeForm[] = [TreeForm.Plane, TreeForm.Ficus, TreeForm.Conifer, TreeForm.Eucalyptus, TreeForm.Palm];
export const TREE_FORM_NAMES = ['plane', 'ficus', 'conifer', 'eucalyptus', 'palm'] as const;
export type TreeFormName = (typeof TREE_FORM_NAMES)[number];
/** M02h5: every form of the byte in order, the five trees then `shrub` 5 and `hedge` 6. */
export const VEG_FORM_NAMES = ['plane', 'ficus', 'conifer', 'eucalyptus', 'palm', 'shrub', 'hedge'] as const;
export type VegFormName = (typeof VEG_FORM_NAMES)[number];
/** M02h5: bit 7 of the TREE byte marks a scatter record (S13's woods, groves, shrubs and hedges); street trees never carry it. */
export const SCATTER_BIT = 0x80;

/** `config/world/tree-forms.json` (`tools/map/schemas/tree-forms.schema.json`). */
export interface TreeFormTable {
  schema: 'world-tree-forms/1';
  note?: string;
  /** Lowercased genus (the first word of the botanical name) to form. */
  genus: Record<string, TreeFormName>;
  /** An unmatched name: the share of `Plane` in the hash-keyed split; the rest is `Ficus` (the default split stays broadleaf). */
  fallback: { planeShare: number };
  /**
   * Per form: the height distribution in metres (a triangular `[min, mode, max]` the mesher reads) and an optional `AssetRef` a later
   * Track B import may put in place of the near LOD (absent: the form stays procedural).
   */
  forms: Record<TreeFormName, { heightM: [number, number, number]; asset?: AssetRef }> & Partial<Record<'shrub' | 'hedge', { heightM: [number, number, number]; asset?: AssetRef }>>;
  /**
   * M02h5: lowercased genera (or whole lowercased names) of DataSF street-tree rows the bake drops: placeholders and stumps that are no
   * tree (`tree(s)`, `shrub`), tuned from M02h4's `treeUnmatched`. Absent: none.
   */
  skipSpecies?: string[];
}

/** The genus of a botanical name: its first word, lowercased (`"Platanus x hispanica :: London Plane"` → `platanus`). */
export function genusOf(name: string): string {
  const t = name.trim().toLowerCase();
  let end = 0;
  while (end < t.length) {
    const c = t.charCodeAt(end);
    // letters, digits and the hyphen of a few genera; anything else (space, colon, parenthesis) ends the genus
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) end++;
    else break;
  }
  return t.slice(0, end);
}

/** The table's form for a genus, or null when the table has no row for it. */
export function formOfGenus(genus: string, table: TreeFormTable): TreeForm | null {
  if (!Object.prototype.hasOwnProperty.call(table.genus, genus)) return null;
  const name = table.genus[genus] as TreeFormName;
  const i = TREE_FORM_NAMES.indexOf(name);
  return i < 0 ? null : (i as TreeForm);
}

/** The hash-keyed split of an unmatched name: `Plane` for the first `planeShare` of the hash range, `Ficus` for the rest. */
export function fallbackForm(key: string, table: TreeFormTable): TreeForm {
  const u = (fnv32(`tree-form|${key}`) % 10000) / 10000;
  return u < table.fallback.planeShare ? TreeForm.Plane : TreeForm.Ficus;
}

/**
 * The form of a botanical name: the table's row for its genus, else the hash split keyed by the whole lowercased name (so one unmatched
 * species keeps one form across the city).
 */
export function formOfSpecies(name: string, table: TreeFormTable): TreeForm {
  return formOfGenus(genusOf(name), table) ?? fallbackForm(name.trim().toLowerCase(), table);
}

/** Whether a name matched a table row (the bake report lists the names that did not). */
export function speciesMatched(name: string, table: TreeFormTable): boolean {
  return formOfGenus(genusOf(name), table) !== null;
}

/** OSM `natural=tree` tags: `species`, then `genus`, then `leaf_type=needleleaved` (Conifer); a node with none of them takes the split. */
export function formOfOsmTags(tags: Readonly<Record<string, string>>, table: TreeFormTable, key: string): { form: TreeForm; name: string; matched: boolean } {
  const species = tags['species'];
  if (species && speciesMatched(species, table)) return { form: formOfSpecies(species, table), name: species, matched: true };
  const genus = tags['genus'];
  if (genus) {
    const f = formOfGenus(genusOf(genus), table);
    if (f !== null) return { form: f, name: genus, matched: true };
  }
  if (tags['leaf_type'] === 'needleleaved') return { form: TreeForm.Conifer, name: species ?? genus ?? 'needleleaved', matched: true };
  const name = species ?? genus ?? 'osm';
  return { form: species || genus ? formOfSpecies(name, table) : fallbackForm(key, table), name, matched: false };
}

/**
 * The form a byte draws: its low seven bits, 0–6 as they are (M02h5: `Shrub` 5, `Hedge` 6; bit 7, the scatter flag, is ignored here), a
 * reserved value (7–127, a newer bake in an older client) as `Plane`.
 */
export function treeFormOfByte(b: number): TreeForm {
  if (!((b | 0) === b && b >= 0 && b <= 255)) return TreeForm.Plane;
  const f = b & 0x7f;
  return f <= 6 ? (f as TreeForm) : TreeForm.Plane;
}

/** M02h5: whether a TREE byte carries the scatter flag (bit 7). */
export function isScatterByte(b: number): boolean {
  return (b | 0) === b && b >= 0 && b <= 255 && (b & SCATTER_BIT) !== 0;
}

/** M02h5: the TREE byte of a form, with the scatter flag when `scatter`. */
export function treeByte(form: TreeForm, scatter: boolean): number {
  return (form & 0x7f) | (scatter ? SCATTER_BIT : 0);
}

/** M02h5: whether a form is a shrub or a hedge (the understory layer: its own pools, `shrubDrawM`, `shrubKeep`). */
export function isUnderstoryForm(f: TreeForm): boolean {
  return f === TreeForm.Shrub || f === TreeForm.Hedge;
}

/**
 * M02h5: whether a DataSF street-tree name is in the table's `skipSpecies` (its lowercased genus or the whole lowercased name): the bake
 * drops it.
 */
export function skippedSpecies(name: string, table: TreeFormTable): boolean {
  const list = table.skipSpecies;
  if (!list || list.length === 0) return false;
  const whole = name.trim().toLowerCase();
  const g = genusOf(name);
  return list.includes(whole) || (g.length > 0 && list.includes(g));
}

/** Whether a world index's C08 version carries forms in the TREE byte (1.1 and later). */
export function readsTreeForms(c08: string): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(c08);
  if (!m) return false;
  const major = Number(m[1]), minor = Number(m[2]);
  return major > 1 || (major === 1 && minor >= 1);
}

/**
 * The triangular quantile of `u` in [0, 1] over `[min, mode, max]`: `min` at 0, `max` at 1, and the mode at `(mode − min) / (max − min)`.
 * The square root is detmath's (C02), so the bake, the worker and the tests agree to the bit.
 */
export function triangularQuantile(u: number, min: number, mode: number, max: number): number {
  const w = max - min;
  if (!(w > 0)) return min;
  const c = (mode - min) / w;
  const v = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return v <= c ? min + dsqrt(v * w * (mode - min)) : max - dsqrt((1 - v) * w * (max - mode));
}
