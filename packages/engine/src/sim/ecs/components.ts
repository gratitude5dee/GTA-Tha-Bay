/**
 * Engine component registry v1 (C01 table; ids 1-255, owner S01). A published id is never renumbered or reused.
 * Fields of `hashed` components enter stateHash; `snapshot` says which snapshot channels carry the component.
 */
import { defineComponent } from './registry.ts';

export const Transform = defineComponent({
  id: 1, name: 'Transform', owner: 'S01', hashed: true, snapshot: 'render+net',
  schema: { px: 'f64', py: 'f64', pz: 'f64', qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32' },
});
export const Velocity = defineComponent({
  id: 2, name: 'Velocity', owner: 'S01', hashed: true, snapshot: 'net',
  schema: { vx: 'f32', vy: 'f32', vz: 'f32', wx: 'f32', wy: 'f32', wz: 'f32' },
});
/** Written by the allocator only. Not a membership component: every id has a generation. */
export const Gen = defineComponent({
  id: 3, name: 'Gen', owner: 'S01', hashed: false, snapshot: 'none',
  schema: { gen: 'u16' },
});
export const Key = defineComponent({
  id: 4, name: 'Key', owner: 'S01', hashed: true, snapshot: 'none',
  schema: { key: 'u32' },
});
export const BodyRef = defineComponent({
  id: 5, name: 'BodyRef', owner: 'S01', hashed: false, snapshot: 'none',
  schema: { body: 'u32', collider: 'u32' },
});
export const CharacterBody = defineComponent({
  id: 6, name: 'CharacterBody', owner: 'S01', hashed: true, snapshot: 'none',
  schema: { radius: 'f32', height: 'f32', grounded: 'u8', groundNormalY: 'f32', airTicks: 'u16' },
});
export const Control = defineComponent({
  id: 7, name: 'Control', owner: 'S01', hashed: true, snapshot: 'net',
  schema: { owner: 'u8', state: 'u16', sinceTick: 'u32', pending: 'u8', target: 'u32' },
});
export const PlayerControlled = defineComponent({
  id: 8, name: 'PlayerControlled', owner: 'S01', hashed: true, snapshot: 'net',
  schema: { player: 'u8' },
});
export const Vehicle = defineComponent({
  id: 9, name: 'Vehicle', owner: 'S01', hashed: true, snapshot: 'render+net',
  schema: {
    handling: 'u32', throttle: 'i8', steer: 'i8', brake: 'i8', handbrake: 'u8', gear: 'i8', rpm: 'f32', speed: 'f32', seats: 'u8',
  },
});
export const VehicleDamage = defineComponent({
  id: 10, name: 'VehicleDamage', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { body: 'f32', engine: 'f32', tires: ['f32', 4] },
});
export const Seat = defineComponent({
  id: 11, name: 'Seat', owner: 'S01', hashed: true, snapshot: 'net',
  schema: { vehicle: 'u32', seat: 'i8' },
});
export const Health = defineComponent({
  id: 12, name: 'Health', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { hp: 'f32', max: 'f32', ko: 'u8', koUntilTick: 'u32' },
});
export const Anim = defineComponent({
  id: 13, name: 'Anim', owner: 'S01', hashed: false, snapshot: 'render',
  schema: { graph: 'u32', state: 'u16', p0: 'f32', p1: 'f32', sinceTick: 'u32' },
});
export const RenderKey = defineComponent({
  id: 14, name: 'RenderKey', owner: 'S01', hashed: false, snapshot: 'render',
  schema: { asset: 'u32', variant: 'u8', visible: 'u8', lodBias: 'i8' },
});
export const Interactable = defineComponent({
  id: 15, name: 'Interactable', owner: 'S01', hashed: true, snapshot: 'none',
  schema: { kind: 'u16', radius: 'f32', coneDeg: 'f32', priority: 'i8', prompt: 'u32', flags: 'u16', cooldown: 'u16' },
});
export const Combat = defineComponent({
  id: 16, name: 'Combat', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { moveSet: 'u32', move: 'u16', frame: 'u16', hitstun: 'u16', blockstun: 'u16' },
});
export const PoliceUnit = defineComponent({
  id: 17, name: 'PoliceUnit', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { role: 'u8', tactic: 'u8', assignedTick: 'u32', target: 'u32' },
});
export const Witness = defineComponent({
  id: 18, name: 'Witness', owner: 'S01', hashed: true, snapshot: 'none',
  schema: { kind: 'u8', infraction: 'u16', reportAtTick: 'u32' },
});
export const Pickup = defineComponent({
  id: 19, name: 'Pickup', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { item: 'u32', qty: 'u16', respawnTicks: 'u32' },
});
export const Ambient = defineComponent({
  id: 20, name: 'Ambient', owner: 'S01', hashed: true, snapshot: 'none',
  schema: { cell: 'u32', slot: 'u16', spawnTick: 'u32' },
});
export const Portal = defineComponent({
  id: 21, name: 'Portal', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { portal: 'u32', sealed: 'u8' },
});
export const AudioEmitter = defineComponent({
  id: 22, name: 'AudioEmitter', owner: 'S01', hashed: false, snapshot: 'render',
  schema: { set: 'u32', p0: 'f32', p1: 'f32', flags: 'u8' },
});
export const CameraAnchor = defineComponent({
  id: 23, name: 'CameraAnchor', owner: 'S01', hashed: false, snapshot: 'none',
  schema: { headY: 'f32', chestY: 'f32', seatX: 'f32', seatY: 'f32', seatZ: 'f32' },
});
export const Ragdoll = defineComponent({
  id: 24, name: 'Ragdoll', owner: 'S01', hashed: true, snapshot: 'render',
  schema: { untilTick: 'u32', impulse: ['f32', 3] },
});

// Tags 30-39: hashed (presence only), no fields, no snapshot channel.
const tag = (id: number, name: string) =>
  defineComponent({ id, name, owner: 'S01', hashed: true, snapshot: 'none', schema: {} });
export const LocalPlayer = tag(30, 'LocalPlayer');
export const Police = tag(31, 'Police');
export const Robotaxi = tag(32, 'Robotaxi');
export const MissionOwned = tag(33, 'MissionOwned');
export const Persistent = tag(34, 'Persistent');
export const Ped = tag(35, 'Ped');
export const Prop = tag(36, 'Prop');
export const NoCollide = tag(37, 'NoCollide');
export const Hidden = tag(38, 'Hidden');
export const Busted = tag(39, 'Busted');

/** Registry v1 in ascending id order. */
export const ENGINE_COMPONENTS = [
  Transform, Velocity, Gen, Key, BodyRef, CharacterBody, Control, PlayerControlled, Vehicle, VehicleDamage, Seat, Health,
  Anim, RenderKey, Interactable, Combat, PoliceUnit, Witness, Pickup, Ambient, Portal, AudioEmitter, CameraAnchor, Ragdoll,
  LocalPlayer, Police, Robotaxi, MissionOwned, Persistent, Ped, Prop, NoCollide, Hidden, Busted,
] as const;
