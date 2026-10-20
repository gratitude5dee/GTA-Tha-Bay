/**
 * Interaction kinds (C06 1.1 `InteractKind`, 01-engine-save-modes.md "Interaction system"). The ids are the values of the
 * spec's const enum; the name map lets prefab JSON say `"kind": "EnterVehicle"`.
 */
export const INTERACT_KIND = {
  EnterVehicle: 1,
  Talk: 2,
  Pickup: 3,
  Door: 4,
  Shop: 5,
  SafehouseSave: 6,
  MissionStart: 7,
  ModeEntry: 8,
  Experience: 9,
  Respray: 10,
  Transit: 11,
  Generic: 99,
} as const;

export type InteractKindName = keyof typeof INTERACT_KIND;
export type InteractKind = (typeof INTERACT_KIND)[InteractKindName];

export const INTERACT_KIND_NAMES: Readonly<Record<number, InteractKindName>> = Object.freeze(
  Object.fromEntries(Object.entries(INTERACT_KIND).map(([k, v]) => [v, k])) as Record<number, InteractKindName>,
);
