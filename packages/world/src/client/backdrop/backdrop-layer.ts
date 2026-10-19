/**
 * The backdrop (R-MAP-02; 02-world-maps.md section 4.3): everything beyond the baked city, drawn in a pass of its own before the
 * world pass (`RendererHost.backdrop`), because a 0.1 m near plane and an 80 km far plane do not fit one standard depth buffer.
 *
 *  - desktop tiers: the `far-bay-dem` ring out to 80 km, plus the `far-bay-massing` boxes (switch `world.massing`);
 *  - the other tiers: the skyline cards, 20 km on `mobile` and `xr-visionpro`, 10 km on `mobile-low` and `xr-quest` (switch `world.cards`).
 *
 * At most three render objects, all added to the scene in one frame (one upload at boot). The sky colour and the haze that blends
 * the ring into it are placeholders until the sky of M02b2.
 */
import {
  Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, type InstancedMesh, type Mesh, type Texture,
} from 'three/webgpu';
import type { QualityTierId } from '@dv/shared';
import { backdropOf } from '../../sim/streaming/boot.ts';
import { hexToLinear } from '../chunks/mesher.ts';
import { atlasTexture, createCards } from './cards.ts';
import { BACKDROP, cardsLayout, type MassingInstances, type RingMesh } from './far-mesh.ts';
import { createMassing } from './massing.ts';
import { createRing, ringMaterial } from './ring.ts';

export interface JobClient {
  job(name: string, args: unknown): Promise<unknown>;
}

export interface BackdropInfo {
  ringKm: number | null;
  cardsKm: number | null;
  massing: boolean;
  renderObjects: number;
  bootUploads: number;
}

export interface BackdropOptions {
  tier: QualityTierId;
  jobs: JobClient;
  /** `config/platform-flags.json` `world.cards` and `world.massing`. */
  flags: { cards: boolean; massing: boolean };
  /** Where the player starts: the cards face it. */
  spawn: { x: number; z: number };
}

export const BACKDROP_NEAR_M = 60;
export const BACKDROP_FAR_M = 140_000;

export class BackdropLayer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, BACKDROP_NEAR_M, BACKDROP_FAR_M);
  /** The backdrop pass's lights: the sky drives them with the world pass's (M02b2). */
  readonly lights: [HemisphereLight, DirectionalLight];
  private readonly meshes: (Mesh | InstancedMesh)[] = [];
  private textures: Texture[] = [];
  private bootUploads = 0;
  private ring = false;
  private cards = false;
  private massing = false;

  constructor(private readonly o: BackdropOptions) {
    const sky = new Color().setRGB(...hexToLinear(BACKDROP.colors.sky));
    this.scene.background = sky;
    // Haze: the ring melts into the sky at the far end.
    this.scene.fog = new Fog(sky, 12_000, 110_000);
    const hemi = new HemisphereLight(0xdbe9ff, 0x6a6f64, 3.4);
    const sun = new DirectionalLight(0xfff1d6, 2.8);
    sun.position.set(120, 220, 80);
    this.lights = [hemi, sun];
    this.scene.add(hemi, sun);
  }

  /** Fetches and builds the backdrop of the tier; every object joins the scene in this one call (one upload frame). */
  async load(): Promise<void> {
    const mode = backdropOf(this.o.tier);
    const built: (Mesh | InstancedMesh)[] = [];
    if (mode.ring) {
      const ring = (await this.o.jobs.job('world.far', { name: 'ring', tier: this.o.tier, ringStride: 1 })) as RingMesh;
      built.push(createRing(ring, ringMaterial()));
      this.ring = true;
      if (this.o.flags.massing) {
        const m = (await this.o.jobs.job('world.far', { name: 'massing', tier: this.o.tier })) as MassingInstances;
        if (m.count > 0) {
          built.push(createMassing(m));
          this.massing = true;
        }
      }
    } else if (this.o.flags.cards && mode.cardsKm !== null) {
      const { png } = (await this.o.jobs.job('world.far', { name: 'cards', tier: this.o.tier })) as { png: ArrayBuffer };
      const atlas = await atlasTexture(png);
      this.textures.push(atlas);
      built.push(createCards(cardsLayout(this.o.spawn, mode.cardsKm), atlas));
      this.cards = true;
    }
    if (built.length > 0) {
      for (const m of built) this.scene.add(m);
      this.meshes.push(...built);
      this.bootUploads = 1;
    }
  }

  /** Copies the world camera's pose and lens; the backdrop pass has its own near and far planes. */
  sync(main: PerspectiveCamera): void {
    const c = this.camera;
    c.position.copy(main.position);
    c.quaternion.copy(main.quaternion);
    if (c.fov !== main.fov || c.aspect !== main.aspect) {
      c.fov = main.fov;
      c.aspect = main.aspect;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }

  /** Same sun as the world pass, so the ring and the city agree (M02b2 drives both). */
  setSun(x: number, y: number, z: number): void {
    this.lights[1].position.set(x, y, z);
  }

  info(): BackdropInfo {
    const mode = backdropOf(this.o.tier);
    return {
      ringKm: this.ring ? 80 : null,
      cardsKm: this.cards ? mode.cardsKm : null,
      massing: this.massing,
      renderObjects: this.meshes.length,
      bootUploads: this.bootUploads,
    };
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      const mat = m.material as { dispose?: () => void };
      mat.dispose?.();
      this.scene.remove(m);
    }
    this.meshes.length = 0;
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }
}
