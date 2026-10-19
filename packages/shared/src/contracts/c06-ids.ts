/**
 * The two C06 id types that C05 imports. The full `c06-modes.ts` (C06 1.1) is M04a2's file; it needs PhysicsQueries and
 * SimEventBus, which no spec section defines (reported as a proposal in M04a1). These two lines are copied verbatim
 * from the C06 block; M04a2 re-exports them from c06-modes.ts. See BD-M04a1-01.
 */
export type GameModeId = 'story' | 'sandbox' | 'racing' | 'fighter' | 'tycoon' | `exp:${string}`;
export type UnlockEventId = `unlock.${string}`;     // unlock.racing, unlock.fighter.rap_lyricist, unlock.district.d6
