/**
 * `crowd.attract` sources (living part 4.4; M03b2): an event (a sideshow, a scene) asks the pedestrians within 40 m to stop and
 * film or cheer. At most 3 sources are live; a fourth is refused until one is released. Released by the id it returned.
 * Pure; C02 lint applies.
 */
export const ATTRACT_RANGE_M = 40;
export const ATTRACT_CAP = 3;

export interface Attractor {
  id: number;
  x: number;
  z: number;
  /** Who set it (a mission or a mode), for the owner-release rule of the other world switches. */
  by: string;
}

export class AttractBoard {
  private nextId = 1;
  private readonly list: Attractor[] = [];

  /** Adds a source; returns its id, or 0 when 3 are live. */
  add(x: number, z: number, by: string): number {
    if (this.list.length >= ATTRACT_CAP) return 0;
    const a: Attractor = { id: this.nextId++, x, z, by };
    this.list.push(a);
    return a.id;
  }

  release(id: number): void {
    const i = this.list.findIndex((a) => a.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  releaseBy(by: string): void {
    for (let i = this.list.length - 1; i >= 0; i--) if ((this.list[i] as Attractor).by === by) this.list.splice(i, 1);
  }

  get(id: number): Attractor | undefined {
    return this.list.find((a) => a.id === id);
  }

  live(): readonly Attractor[] {
    return this.list;
  }

  /** The nearest source within range of (x, z), or null (ties: the older id). */
  nearest(x: number, z: number): Attractor | null {
    let best: Attractor | null = null;
    let bd = ATTRACT_RANGE_M * ATTRACT_RANGE_M;
    for (const a of this.list) {
      const d = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  clear(): void {
    this.list.length = 0;
  }

  /** For the hash and the save: the sources in id order. */
  entries(): readonly Attractor[] {
    return this.list;
  }

  load(list: readonly Attractor[], next: number): void {
    this.list.length = 0;
    for (const a of list) this.list.push({ ...a });
    this.nextId = next;
  }

  get nextValue(): number {
    return this.nextId;
  }
}
