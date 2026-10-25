/**
 * The NPC components 768 to 775 (04-npc.md section 3; C01 npc range). They mirror what `BrainSim` knows about each named NPC so the snapshot,
 * the debug tools and the state hash see it as ECS state. The sim is the writer: `system.ts` copies it in once per tick. Sim code; C02 lint applies.
 *
 * Vector fields are spelled as scalars (`s0` to `s5`) because the prefab `init` addresses a field by name.
 */
import { defineComponent } from '@dv/engine/sim';

/** 768: who the entity is (StringTable id of the NPC id), the soul version it was built from, and its dense slot. */
export const NpcIdentity = defineComponent({
  id: 768, name: 'NpcIdentity', owner: 'S04', hashed: true, snapshot: 'none',
  schema: { npc: 'u32', soulVersion: 'u16', slot: 'u16' },
});

/** 769: the active schedule block and the game day the daily stream was seeded for. */
export const ScheduleCursor = defineComponent({
  id: 769, name: 'ScheduleCursor', owner: 'S04', hashed: true, snapshot: 'none',
  schema: { block: 'i16', day: 'i32' },
});

/** 770: the behaviour tree: tree id, last leaf, child index per depth, leaf timer and its drawn length. */
export const NpcBrain = defineComponent({
  id: 770, name: 'NpcBrain', owner: 'S04', hashed: true, snapshot: 'none',
  schema: { tree: 'i8', leaf: 'u8', s0: 'u8', s1: 'u8', s2: 'u8', s3: 'u8', t: 'u32', aux: 'i32' },
});

/** 771: the utility scores of the last pass (schedule, intent, greet, flee, hold, talk) and the winner. Derived: not hashed. */
export const UtilityScores = defineComponent({
  id: 771, name: 'UtilityScores', owner: 'S04', hashed: false, snapshot: 'none',
  schema: { winner: 'u8', s0: 'f32', s1: 'f32', s2: 'f32', s3: 'f32', s4: 'f32', s5: 'f32' },
});

/** 772: conversation state: bit 0 talking, bit 1 mission lock, bit 2 enabled (not removed by the kill-switch). */
export const Talkable = defineComponent({
  id: 772, name: 'Talkable', owner: 'S04', hashed: true, snapshot: 'none',
  schema: { flags: 'u8', locks: 'u8' },
});

/** 773: the last bark of the entity (tick and tag index). Derived from the bark system: not hashed. */
export const BarkEmitter = defineComponent({
  id: 773, name: 'BarkEmitter', owner: 'S04', hashed: false, snapshot: 'none',
  schema: { lastTick: 'u32', lastTag: 'u8' },
});

/** 774: the hero intent that holds: goal and target (StringTable ids, 0 none), urgency, the tick or block it holds until. */
export const IntentGoal = defineComponent({
  id: 774, name: 'IntentGoal', owner: 'S04', hashed: true, snapshot: 'none',
  schema: { goal: 'u32', target: 'u32', urgency: 'u8', until: 'i32', block: 'i16' },
});

/** 775: the LOD tier (0 A, 1 B, 2 C) and the distance to the player at the last pass. Derived: not hashed. */
export const NpcLod = defineComponent({
  id: 775, name: 'NpcLod', owner: 'S04', hashed: false, snapshot: 'none',
  schema: { tier: 'u8', dist: 'f32' },
});

export const NPC_COMPONENTS = [NpcIdentity, ScheduleCursor, NpcBrain, UtilityScores, Talkable, BarkEmitter, IntentGoal, NpcLod] as const;

/** `Talkable.flags` bits. */
export const TALK_FLAG = { talking: 1, locked: 2, enabled: 4 } as const;
