// packages/shared/src/contracts/anim-states.ts
// C04 (pure; S05 tools/assets and packages/shared/src/rig import these without the engine client; DL-066).
// Copied from spec/domains/01-engine-contracts.md, "Engine service interfaces". The ANIM_STATE constants are a Builder
// addition so sim and client code share one spelling of the ids the spec lists in prose.
export type SkeletonId = 'bay_rig_v1';   // = C07 rigFamily and asset rig/bay_rig_v1; vendor aliases in packages/shared/src/rig/bay_rig_v1.json (S05)
export const HUMANOID_BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'l_shoulder', 'l_upperArm', 'l_lowerArm', 'l_hand', 'r_shoulder', 'r_upperArm', 'r_lowerArm', 'r_hand',
  'l_upperLeg', 'l_lowerLeg', 'l_foot', 'l_toes', 'r_upperLeg', 'r_lowerLeg', 'r_foot', 'r_toes'] as const;

/** Network animation state (C11 SNAP `anim`, u8). Each C01 Control.state maps to one id: 0 idle, 1 walk, 2 run, 3 sprint,
 *  4 jump, 5 fall, 6 land, 7 vault, 8 enter vehicle, 9 drive, 10 passenger, 11 exit vehicle, 12 ragdoll, 13 get up,
 *  14 knocked out, 15 melee ready, 16 attack, 17 hitstun, 18 blockstun, 19 grappled, 20 swim, 21 emote, 22 arrested;
 *  23–127 reserved for S01; 128–159 racing, 160–207 fighter, 208–255 tycoon (mode-owned; blocks assigned by ADR, DL-091). */
export type AnimStateId = number; // u8

export const ANIM_STATE = {
  idle: 0, walk: 1, run: 2, sprint: 3, jump: 4, fall: 5, land: 6, vault: 7, enterVehicle: 8, drive: 9, passenger: 10,
  exitVehicle: 11, ragdoll: 12, getUp: 13, knockedOut: 14, meleeReady: 15, attack: 16, hitstun: 17, blockstun: 18,
  grappled: 19, swim: 20, emote: 21, arrested: 22,
} as const satisfies Record<string, AnimStateId>;
