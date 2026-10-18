import type { StringTable } from '@dv/shared';

/**
 * Interned strings for component fields (C01). Id 0 is the empty string. Ids are assigned in first-intern order,
 * which is driven by sim order, so two runs of the same sim assign the same ids. `size` counts the reserved
 * empty entry.
 */
export class StringTableImpl implements StringTable {
  private list: string[] = [''];
  private ids = new Map<string, number>([['', 0]]);

  get size(): number {
    return this.list.length;
  }

  intern(s: string): number {
    let id = this.ids.get(s);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(s);
      this.ids.set(s, id);
    }
    return id;
  }

  get(id: number): string {
    const s = this.list[id];
    if (s === undefined) throw new RangeError(`StringTable: unknown id ${id}`);
    return s;
  }

  /** All strings in id order (index 0 is the empty string). */
  toArray(): readonly string[] {
    return this.list;
  }

  /** Replace the table (checkpoint restore). `list[0]` must be the empty string. */
  load(list: readonly string[]): void {
    if (list[0] !== '') throw new Error('StringTable.load: entry 0 must be the empty string');
    this.list = [...list];
    this.ids = new Map();
    for (let i = 0; i < this.list.length; i++) this.ids.set(this.list[i] as string, i);
  }
}
