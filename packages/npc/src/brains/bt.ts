/**
 * The in-house behaviour tree (04-npc-builder.md section C8; M06c). Three composites and a leaf are enough for the activity
 * subtrees: `seq` (all children in order), `sel` (the first child that does not fail) and `loop` (the child again and again, one pass
 * per brain step so a subtree that finishes at once cannot spin inside a step). The running position is a child index per depth in
 * `NpcAgent.stack` plus the leaf's timer, so the whole state is a handful of integers that hash, save and replay. Sim code; C02 lint applies.
 */
import type { NpcAgent } from './agent.ts';
import type { BtCtx } from './bt-ctx.ts';

export const Status = { Running: 0, Success: 1, Failure: 2 } as const;
export type StatusId = (typeof Status)[keyof typeof Status];

export interface BtLeaf {
  readonly k: 'leaf';
  /** Unique over the leaf library; the trace and the debug overlay report it. */
  readonly id: number;
  readonly name: string;
  run(a: NpcAgent, ctx: BtCtx): StatusId;
}
export interface BtComposite {
  readonly k: 'seq' | 'sel' | 'loop';
  readonly c: readonly BtNode[];
}
export type BtNode = BtLeaf | BtComposite;

export const seq = (...c: BtNode[]): BtComposite => ({ k: 'seq', c });
export const sel = (...c: BtNode[]): BtComposite => ({ k: 'sel', c });
export const loop = (c: BtNode): BtComposite => ({ k: 'loop', c: [c] });

/** The deepest tree the stack holds: loop, seq, sel, leaf is three composites. */
export const MAX_DEPTH = 4;

/** Clears the stack from `depth` down and the leaf timer. */
export function resetFrom(a: NpcAgent, depth: number): void {
  for (let d = depth; d < MAX_DEPTH; d++) a.stack[d] = 0;
  a.leafT = 0;
  a.leafAux = -1;
}

/** Back to the start of the tree (a new winner, a new block): the next run begins at the root. */
export function btReset(a: NpcAgent): void {
  resetFrom(a, 0);
}

function step(n: BtNode, depth: number, a: NpcAgent, ctx: BtCtx): StatusId {
  if (n.k === 'leaf') {
    a.leafId = n.id;
    return n.run(a, ctx);
  }
  if (n.k === 'loop') {
    const child = n.c[0];
    if (!child) return Status.Failure;
    const s = step(child, depth + 1, a, ctx);
    if (s !== Status.Running) resetFrom(a, depth + 1);
    return Status.Running;
  }
  const len = n.c.length;
  if (len === 0) return n.k === 'seq' ? Status.Success : Status.Failure;
  let i = a.stack[depth] as number;
  for (let guard = 0; guard <= len; guard++) {
    const child = n.c[i];
    if (!child) break;
    const s = step(child, depth + 1, a, ctx);
    if (s === Status.Running) {
      a.stack[depth] = i;
      return Status.Running;
    }
    if (n.k === 'seq') {
      if (s === Status.Failure) {
        resetFrom(a, depth);
        return Status.Failure;
      }
      i++;
      if (i >= len) {
        resetFrom(a, depth);
        return Status.Success;
      }
    } else {
      if (s === Status.Success) {
        resetFrom(a, depth);
        return Status.Success;
      }
      i++;
      if (i >= len) {
        resetFrom(a, depth);
        return Status.Failure;
      }
    }
    // the next child starts clean
    a.stack[depth] = i;
    resetFrom(a, depth + 1);
  }
  return Status.Running;
}

/** Runs one brain step of `root` for the agent. */
export function runTree(root: BtNode, a: NpcAgent, ctx: BtCtx): StatusId {
  return step(root, 0, a, ctx);
}
