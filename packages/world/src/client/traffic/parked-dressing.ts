/**
 * Parked dressing (M02h6; C08 1.1 rule 12, DL-741): render-only parked cars on the slots the sim never fills on this tier, so a curb with
 * C08 `parkingSides` reads as parked-up beyond the few cars the sim parks. No entity, no collider, nothing written to the sim, outside
 * `CrowdLimits` (DL-740 3), and so no state hash change.
 *
 *  - the slots: each resident L0 unit's `UnitMesh.parked` (the mesher keeps only slots with an index at or past `densityCap(capacity,
 *    tierFactors.parked[tier])` (C01 prefix rule), thinned to `dressShare`), so the sim's cars and the dressing never share a slot;
 *  - pose from the sim's `parkedPose` rule, archetype and colour from the sim's `slotUnit` draws (`pickArchetype`, robotaxi and cruiser
 *    parked as sedans, the 12-colour palette), as `TrafficSim.parkedPass` would;
 *  - one `InstancedMesh` per M10d1 family of the profile (`config/world/furniture.json` `parked.families`: `full` four, `lite` three, `min`
 *    the car family alone, every archetype on its body), on that family's model with its glass merged in (the opaque material shades the
 *    glass through the part id), lights off; the gray-box car until the model has arrived;
 *  - drawn only between `ghostM` and `dressFarM` from the player and the camera, with dithered fades of `fadeM` at both ends, so the player
 *    never reaches a bodiless car; a slot within `skipCarLengths` car lengths of a live car pose is left out; at most `caps[profile]`, nearest
 *    first;
 *  - the dressed cars join M02g1's blob shadows (`blobs`), which adds no render object.
 */
import { InstancedBufferAttribute, InstancedMesh, Group, type BufferGeometry, type Material, type Object3D } from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import type { ArtLoader } from '@dv/engine/client/vehicle/art';
import { ambientKey, ctrU32, worldSeedOf, type ChunkKey } from '@dv/shared';
import { ARCHETYPES, PALETTE, pickArchetype } from '../../sim/traffic/components.ts';
import { profileName } from '../../sim/traffic/density.ts';
import { PARKED_STRIDE, FURNITURE } from '../chunks/mesher.ts';
import type { UnitMesh } from '../chunks/mesh-types.ts';
import type { SkyNodes } from '../sky/nodes.ts';
import { attribute, clamp, dot, float, fract, select, sin, screenCoordinate, vec2, type L } from '../sky/tsl.ts';
import { familyOf, mergeModel, placeholderGeometry, TRAFFIC_ART, type FamilyGeometry } from './archetype-mesh.ts';
import { makeArtMaterial } from './materials.ts';

export type DressingProfile = 'full' | 'lite' | 'min';

const INV = 1 / 4294967296;
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The sim's draws for a parked slot (`TrafficSim.parkedPass`): archetype (robotaxi and cruiser park as sedans) and palette colour. */
export function parkedLook(seed: number, cell: ChunkKey, slot: number, densityProfile: number): { arch: number; color: number } {
  const u = ctrU32(seed, ambientKey(cell, slot), 1 * 8 + 3) * INV;
  let arch = pickArchetype(u, profileName(densityProfile));
  if (arch === 3 || arch === 7) arch = 1;
  const color = Math.floor(ctrU32(seed, ambientKey(cell, slot), 1 * 8 + 4) * INV * PALETTE.length) % PALETTE.length;
  return { arch, color };
}

/** A dressing candidate in world space. */
export interface DressSlot {
  key: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  arch: number;
  color: number;
}

/**
 * The fade of a dressed car at distance `dPlayer` from the player and `dCam` from the camera (0 hidden, 1 full): it rises over `fadeM`
 * past `ghostM` from the nearer of the two and falls over `fadeM` before `dressFarM` from the camera.
 */
export function dressFade(dPlayer: number, dCam: number, ghostM: number, farM: number, fadeM: number): number {
  const near = Math.min(dPlayer, dCam);
  const a = Math.min(1, Math.max(0, (near - ghostM) / fadeM));
  const b = Math.min(1, Math.max(0, (farM - dCam) / fadeM));
  return a * b;
}

interface Family {
  name: string;
  mesh: InstancedMesh;
  tint: InstancedBufferAttribute;
  lights: InstancedBufferAttribute;
  fade: InstancedBufferAttribute;
  size: readonly [number, number, number];
  count: number;
}

export interface ParkedDressingOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  sky: SkyNodes;
  profile: DressingProfile;
  /** The bake id (the slots' draws are seeded with `worldSeedOf(bakeId)`, as the sim's are with `WorldIndex.worldSeed`). */
  bakeId: string;
  /** Loads a family's model; without it every family keeps the gray-box car. */
  load?: ArtLoader;
}

export interface ParkedDressingReport {
  profile: DressingProfile;
  /** Instances drawn now (fade above 0) and the cap. */
  instances: number;
  cap: number;
  /** Candidates of the resident units (before distance, live-pose and cap filtering). */
  candidates: number;
  /** Render objects the dressing adds now. */
  objects: number;
  families: string[];
  loaded: number;
  layer: boolean;
  /** QA: the drawn slots with their fades (AC-4, AC-6). */
  drawn?: { key: string; x: number; z: number; fade: number; arch: number }[];
}

export class ParkedDressing {
  readonly group = new Group();
  readonly profile: DressingProfile;
  private readonly cap: number;
  private readonly seed: number;
  private readonly families: Family[] = [];
  private readonly famOfArch: number[] = [];
  private readonly scale: [number, number, number][] = [];
  private readonly units = new Map<string, DressSlot[]>();
  private readonly materials: Material[] = [];
  private layerOn = true;
  private lookOn = true;
  private frame = 0;
  private lastAt: [number, number] = [1e9, 1e9];
  private dirty = true;
  private drawn: { key: string; x: number; y: number; z: number; yaw: number; fade: number; arch: number }[] = [];
  private loaded = 0;
  private disposed = false;

  constructor(private readonly o: ParkedDressingOptions) {
    this.profile = o.profile;
    this.cap = FURNITURE.parked.caps[o.profile];
    this.seed = worldSeedOf(o.bakeId);
    this.group.name = 'world.parked';
    const art = TRAFFIC_ART.profiles[o.profile];
    const names = FURNITURE.parked.families[o.profile].filter((n) => art.families[n] !== undefined);
    const material = makeArtMaterial({ profile: o.profile, sky: o.sky, pass: 'opaque', instanced: true });
    // the dither fade: the instance's `aFade` against screen-space noise (the chunks' fade-in, M02b1)
    const noise = fract(sin(dot((screenCoordinate as L).xy, vec2(12.9898, 78.233))).mul(43758.5453)) as L;
    const fade = attribute('aFade', 'float') as L;
    (material as unknown as { opacityNode: unknown }).opacityNode = select(noise.lessThan(clamp(fade, 0, 1)), float(1), float(0));
    material.alphaTest = 0.5;
    this.materials.push(material);
    for (const name of names) {
      const ph = placeholderGeometry();
      const n = Math.max(1, this.cap);
      const tint = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const lights = new InstancedBufferAttribute(new Float32Array(n), 1);
      const fadeAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
      const geo = this.withAttrs(ph.opaque, tint, lights, fadeAttr);
      const mesh = new InstancedMesh(geo, material, n);
      mesh.name = `parked.${name}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = false;
      (mesh.instanceMatrix.array as Float32Array).fill(0);
      this.group.add(mesh);
      this.families.push({ name, mesh, tint, lights, fade: fadeAttr, size: ph.size, count: 0 });
    }
    // every archetype to its family; on `min` all of them draw the car family's body
    for (const a of ARCHETYPES) {
      const fam = o.profile === 'min' ? names[0] : familyOf(TRAFFIC_ART, o.profile, a.asset);
      const fi = fam === undefined ? -1 : names.indexOf(fam);
      this.famOfArch[a.id] = fi >= 0 ? fi : 0;
    }
    this.setScales();
    o.parent.add(this.group);
    if (o.load) this.loadModels(o.load);
  }

  private withAttrs(g: BufferGeometry, tint: InstancedBufferAttribute, lights: InstancedBufferAttribute, fade: InstancedBufferAttribute): BufferGeometry {
    g.setAttribute('aTint', tint);
    g.setAttribute('aLights', lights);
    g.setAttribute('aFade', fade);
    return g;
  }

  private setScales(): void {
    for (const a of ARCHETYPES) {
      const fam = this.families[this.famOfArch[a.id] ?? 0];
      const m = TRAFFIC_ART.members[a.asset];
      if (!fam || !m) {
        this.scale[a.id] = [1, 1, 1];
        continue;
      }
      this.scale[a.id] = [m.size[0] / fam.size[0], m.size[1] / fam.size[1], m.size[2] / fam.size[2]];
    }
  }

  private loadModels(load: ArtLoader): void {
    const variant = TRAFFIC_ART.profiles[this.profile].variant;
    for (const fam of this.families) {
      const ref = TRAFFIC_ART.bases[fam.name];
      if (!ref) continue;
      void load(ref, variant).then(
        (model) => {
          if (!model || this.disposed) return;
          // the glass merged into the opaque geometry: the part id shades it (one draw per family)
          const g: FamilyGeometry = mergeModel(model, false);
          const old = fam.mesh.geometry;
          fam.mesh.geometry = this.withAttrs(g.opaque, fam.tint, fam.lights, fam.fade);
          old.dispose();
          g.glass?.dispose();
          fam.size = g.size;
          this.loaded++;
          this.setScales();
          this.dirty = true;
        },
        () => undefined,
      );
    }
  }

  /** A unit was uploaded: its dressing slots (world space, with the sim's archetype and colour draws). */
  addUnit(id: string, mesh: UnitMesh): void {
    const p = mesh.parked;
    if (!p || p.length < PARKED_STRIDE) {
      this.units.delete(id);
      return;
    }
    const out: DressSlot[] = [];
    for (let i = 0; i + PARKED_STRIDE - 1 < p.length; i += PARKED_STRIDE) {
      const slot = p[i + 4] as number;
      const look = parkedLook(this.seed, mesh.key, slot, p[i + 5] as number);
      out.push({ key: `${mesh.key}:${slot}`, x: mesh.originX + (p[i] as number), y: p[i + 1] as number, z: mesh.originZ + (p[i + 2] as number), yaw: p[i + 3] as number, ...look });
    }
    this.units.set(id, out);
    this.dirty = true;
  }

  removeUnit(id: string): void {
    if (this.units.delete(id)) this.dirty = true;
  }

  /** The `parked` layer: off hides the dressing (render only). */
  setLayer(on: boolean): void {
    this.layerOn = on;
    for (const f of this.families) f.mesh.visible = on && this.lookOn && f.count > 0;
  }

  /** The look switched at runtime (QA `setLook`): the legacy look draws no dressing. */
  setLookOn(on: boolean): void {
    this.lookOn = on;
    this.setLayer(this.layerOn);
  }

  /** A replaced renderer (device loss): every buffer is written and uploaded again on the next update. */
  rebuild(): void {
    this.dirty = true;
  }

  get layer(): boolean {
    return this.layerOn;
  }

  /**
   * Every frame: re-chooses the drawn slots every `everyFrames` frames or when the camera moved `rebandM` (and on a unit change), nearest
   * first, within the fades and away from the live car poses; then feeds their blobs.
   */
  update(f: Pick<WorldFrame, 'camera' | 'player' | 'poses' | 'poseCount'>): void {
    this.frame++;
    const cfg = FURNITURE.parked;
    const cx = f.camera.pos[0], cz = f.camera.pos[2];
    const moved = Math.hypot(cx - this.lastAt[0], cz - this.lastAt[1]) > cfg.rebandM;
    if (!this.dirty && !moved && this.frame % cfg.everyFrames !== 0) return;
    this.dirty = false;
    this.lastAt = [cx, cz];
    const px = f.player ? f.player.pos[0] : cx, pz = f.player ? f.player.pos[2] : cz;
    const ghost = cfg.ghostM[this.profile], far = cfg.dressFarM[this.profile], fadeM = cfg.fadeM;
    const skip = cfg.skipCarLengths * cfg.carLengthM;
    // live car poses (traffic and the sim's parked cars): flagged ambient
    const live: number[] = [];
    const n = f.poseCount ?? 0;
    for (let i = 0; i < n; i++) {
      const pose = f.poses?.[i];
      if (pose && (pose.flags & 2) !== 0) live.push(pose.px, pose.pz);
    }
    const cand: { s: DressSlot; d: number; fade: number }[] = [];
    for (const list of this.units.values()) {
      for (const s of list) {
        const dCam = Math.hypot(s.x - cx, s.z - cz);
        if (dCam > far) continue;
        const fade = dressFade(Math.hypot(s.x - px, s.z - pz), dCam, ghost, far, fadeM);
        if (fade <= 0) continue;
        let near = false;
        for (let k = 0; k + 1 < live.length; k += 2) {
          const dx = (live[k] as number) - s.x, dz = (live[k + 1] as number) - s.z;
          if (dx * dx + dz * dz < skip * skip) {
            near = true;
            break;
          }
        }
        if (!near) cand.push({ s, d: dCam, fade });
      }
    }
    cand.sort((a, b) => a.d - b.d || (a.s.key < b.s.key ? -1 : 1));
    const take = cand.slice(0, this.cap);
    for (const fam of this.families) fam.count = 0;
    this.drawn = [];
    for (const c of take) {
      const fam = this.families[this.famOfArch[c.s.arch] ?? 0];
      if (!fam || fam.count >= fam.mesh.instanceMatrix.count) continue;
      this.write(fam, fam.count, c.s, c.fade);
      fam.count++;
      this.drawn.push({ key: c.s.key, x: c.s.x, y: c.s.y, z: c.s.z, yaw: c.s.yaw, fade: c.fade, arch: c.s.arch });
    }
    for (const fam of this.families) {
      fam.mesh.count = fam.count;
      fam.mesh.visible = this.layerOn && this.lookOn && fam.count > 0;
      fam.mesh.instanceMatrix.needsUpdate = true;
      fam.tint.needsUpdate = true;
      fam.fade.needsUpdate = true;
    }
  }

  private write(fam: Family, i: number, s: DressSlot, fade: number): void {
    const m = fam.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const [sx, sy, sz] = this.scale[s.arch] ?? [1, 1, 1];
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -sn * sx; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = sn * sz; m[o + 9] = 0; m[o + 10] = c * sz; m[o + 11] = 0;
    m[o + 12] = s.x; m[o + 13] = s.y; m[o + 14] = s.z; m[o + 15] = 1;
    const member = TRAFFIC_ART.members[ARCHETYPES[s.arch]?.asset ?? ''];
    const t = fam.tint.array as Float32Array;
    let rgb: [number, number, number];
    if (member && !member.tint && member.paint) {
      const v = parseInt(member.paint.slice(1), 16);
      rgb = [toLinear(((v >> 16) & 255) / 255), toLinear(((v >> 8) & 255) / 255), toLinear((v & 255) / 255)];
    } else {
      const hex = PALETTE[s.color] ?? 0xffffff;
      rgb = [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
    }
    t[i * 3] = rgb[0];
    t[i * 3 + 1] = rgb[1];
    t[i * 3 + 2] = rgb[2];
    (fam.lights.array as Float32Array)[i] = 0;
    (fam.fade.array as Float32Array)[i] = fade;
  }

  /** The drawn cars' blobs (M02g1: one instanced blob object for every actor, so the dressing adds no render object). */
  feedBlobs(push: (x: number, groundY: number, z: number, yaw: number, halfW: number, halfL: number) => void): void {
    if (!this.layerOn || !this.lookOn) return;
    for (const d of this.drawn) {
      const a = ARCHETYPES[d.arch];
      if (a) push(d.x, d.y, d.z, d.yaw, a.halfWidth, a.halfLength);
    }
  }

  get objects(): number {
    return this.families.filter((f) => f.mesh.visible && f.count > 0).length;
  }

  report(qa = false): ParkedDressingReport {
    let candidates = 0;
    for (const l of this.units.values()) candidates += l.length;
    return {
      profile: this.profile, instances: this.drawn.length, cap: this.cap, candidates, objects: this.objects, families: this.families.map((f) => f.name),
      loaded: this.loaded, layer: this.layerOn,
      ...(qa ? { drawn: this.drawn.map((d) => ({ key: d.key, x: d.x, z: d.z, fade: d.fade, arch: d.arch })) } : {}),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.o.parent.remove(this.group);
    for (const f of this.families) {
      f.mesh.geometry.dispose();
      f.mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
