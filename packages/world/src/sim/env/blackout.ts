/**
 * The blackout switch (02-world-living.md section 6 rule 5; M02b2): a hashed, checkpointed flag. While it is on, windows glow at
 * 0.15, street lamps are off and (once TrafficControl adopts it in M02c1/M03b1) signals are dark and robotaxis hold.
 *
 * It follows the C08 `WorldApi.setBlackout(on, by)` shape: the switch is on while at least one owner holds it, and each owner
 * releases only its own hold. Until the traffic milestone lands only the QA bridge and the debug panel set it (owner `debug`).
 * Pure sim code: C02 lint applies.
 */
import type { SimResource } from '@dv/engine/sim';

/** Name of the resource in the state hash. */
export const BLACKOUT_RESOURCE = 'world.blackout';
/** The owner the QA bridge and the debug panel use. */
export const BLACKOUT_DEBUG_OWNER = 'debug';
/** Snapshot side-block key: `1` while the blackout is on (absent otherwise). */
export const BLACKOUT_SIDE_KEY = 'bo';

export class Blackout {
  /** Owners holding the blackout, in ascending order (the order they are hashed in). */
  private holders: string[] = [];

  get on(): boolean {
    return this.holders.length > 0;
  }

  /** Owners holding the blackout now, ascending. */
  owners(): readonly string[] {
    return this.holders;
  }

  /** `on` adds `by` to the holders; off removes it. An empty owner name is ignored. */
  set(on: boolean, by: string): void {
    if (by === '') return;
    const i = this.holders.indexOf(by);
    if (on) {
      if (i < 0) {
        this.holders.push(by);
        this.holders.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      }
    } else if (i >= 0) {
      this.holders.splice(i, 1);
    }
  }

  /** The snapshot side-block entry for this tick. */
  side(): Record<string, unknown> {
    return this.on ? { [BLACKOUT_SIDE_KEY]: 1 } : {};
  }

  resource(): SimResource {
    return {
      name: BLACKOUT_RESOURCE,
      hash: (h) => {
        h.u32(this.holders.length);
        for (const by of this.holders) h.str(by);
      },
      save: (w) => {
        w.u32(this.holders.length);
        for (const by of this.holders) w.str(by);
      },
      load: (r) => {
        this.holders = [];
        for (let n = r.u32(); n > 0; n--) this.holders.push(r.str());
      },
    };
  }
}
