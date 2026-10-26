import type { DraftState } from '@dv/shared/npc';

/**
 * The draft state machine of spec/domains/04-npc-builder.md section C1 (M06b1). The edges below are the diagram's, from `draft` through `private`
 * and on to the review states that M06b2 drives, plus four edges the text implies: a failed soul can be generated again, an edit puts a draft
 * back in `draft` (its text must be validated again) or in `soul_ready` (a soul edit that passes the lints, which the probes then check again).
 * Everything the routes and jobs do goes through `move`, so an illegal change cannot be written whatever the caller believes.
 */
export const EDGES: readonly (readonly [from: DraftState, to: DraftState])[] = [
  ['draft', 'validating'],
  ['validating', 'rejected_auto'],
  ['validating', 'text_ok'],
  ['text_ok', 'soul_generating'],
  ['soul_generating', 'soul_ready'],
  ['soul_generating', 'soul_failed'],
  ['soul_failed', 'soul_ready'],
  ['soul_ready', 'probing'],
  ['probing', 'private'],
  ['probing', 'soul_ready'],
  ['private', 'in_review'],
  ['in_review', 'published'],
  ['in_review', 'soul_ready'],
  ['in_review', 'rejected'],
  ['published', 'unpublished_pending_review'],
  ['unpublished_pending_review', 'published'],
  ['unpublished_pending_review', 'removed'],
  ['published', 'killed'],
  // implied by the text
  ['soul_failed', 'soul_generating'],
  ['soul_ready', 'soul_generating'],
  ['private', 'soul_ready'],
  ['validating', 'draft'],
  ['draft', 'draft'],
  ['rejected_auto', 'draft'],
  ['text_ok', 'draft'],
  ['soul_failed', 'draft'],
  ['soul_ready', 'draft'],
  ['private', 'draft'],
];

const EDGE_SET: ReadonlySet<string> = new Set(EDGES.map(([a, b]) => `${a}>${b}`));

export const canMove = (from: DraftState, to: DraftState): boolean => EDGE_SET.has(`${from}>${to}`);

/** The states each request may start from. Anything else answers 409 `conflict` with the current state. */
export const REQUEST_FROM = {
  validate: ['draft'],
  soul: ['text_ok', 'soul_failed', 'soul_ready'],
  preview: ['private'],
  /** Author edits (PUT): not while a job runs, and not once the draft is in review or published (M06b2). */
  edit: ['draft', 'rejected_auto', 'text_ok', 'soul_failed', 'soul_ready', 'private'],
  /** Delete: anything a P0 author can reach. */
  delete: ['draft', 'validating', 'rejected_auto', 'text_ok', 'soul_generating', 'soul_failed', 'soul_ready', 'probing', 'private'],
} as const satisfies Record<string, readonly DraftState[]>;

export type RequestKind = keyof typeof REQUEST_FROM;

export const allowedFrom = (kind: RequestKind): readonly DraftState[] => REQUEST_FROM[kind];

/** States in which a job is running or about to: edits and deletes wait for it. */
export const BUSY_STATES: readonly DraftState[] = ['validating', 'soul_generating', 'probing'];

/** Throws unless `from` to `to` is an edge of the machine. */
export function move(from: DraftState, to: DraftState): DraftState {
  if (!canMove(from, to)) throw new Error(`illegal draft transition ${from} -> ${to}`);
  return to;
}

/** Where a draft goes when the job that was running on it crashed: back to the state the author can act on. */
export function jobFailedState(state: DraftState): DraftState | null {
  if (state === 'validating') return 'draft';
  if (state === 'soul_generating') return 'soul_failed';
  if (state === 'probing') return 'soul_ready';
  return null;
}
