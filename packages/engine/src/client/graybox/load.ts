import { Group, type MeshStandardNodeMaterial, type Scene } from 'three/webgpu';
import { decodeL0, decodeP0, type RenderChunk, type SimChunk } from '@dv/shared';
import {
  buildChunkMesh, chunkGroup, createGrayboxMaterial, disposeGroup, MAX_OBJECTS_PER_CHUNK, meshObjectCount, meshTriangleCount,
  type ChunkMesh,
} from './mesher.ts';

/** Where the page serves the two fixture packs (hashed static files; the app passes the URLs Vite gives it). */
export interface GrayboxPackUrls {
  p0: string;
  l0: string;
}

export interface GrayboxPacks {
  p0: Uint8Array;
  l0: Uint8Array;
}

/** `BootPayload.config.scenario` of the gray-box world. */
export const GRAYBOX_SCENARIO_ID = 'civic-graybox';

/** Fetches both packs. A failed or empty response throws with the URL, so the engine boot fails with a readable reason. */
export async function fetchGrayboxPacks(urls: GrayboxPackUrls, fetchFn: typeof fetch = fetch): Promise<GrayboxPacks> {
  const get = async (url: string): Promise<Uint8Array> => {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`gray-box pack ${url}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 64) throw new Error(`gray-box pack ${url}: ${bytes.length} bytes`);
    return bytes;
  };
  const [p0, l0] = await Promise.all([get(urls.p0), get(urls.l0)]);
  return { p0, l0 };
}

/**
 * `BootPayload.config` for the sim.worker: the scenario id and the `p0` bytes. The bytes are copied so that the page keeps
 * its own (the worker restarts after a crash and gets the same payload again); the pack is 53 KB.
 */
export function grayboxBootConfig(packs: GrayboxPacks): Record<string, unknown> {
  return { scenario: GRAYBOX_SCENARIO_ID, packs: { p0: packs.p0.slice().buffer } };
}

export interface GrayboxInfo {
  chunks: number;
  /** Render objects in each chunk's group, in chunk order. */
  objectsPerChunk: number[];
  maxObjectsPerChunk: number;
  triangles: number;
  keys: string[];
}

/**
 * The gray-box block as three objects: one `Group` per chunk, at most six meshes each, one shared TSL node material. The page
 * builds it from the packs it fetched; the sim.worker decodes `p0` again for the colliders.
 */
export class GrayboxWorld {
  readonly root: Group;
  readonly meshes: ChunkMesh[] = [];
  readonly sim: SimChunk[];
  readonly render: RenderChunk[];
  private readonly material: MeshStandardNodeMaterial;
  private scene: Pick<Scene, 'add' | 'remove'> | null = null;

  constructor(packs: GrayboxPacks) {
    this.sim = decodeP0(packs.p0);
    this.render = decodeL0(packs.l0, this.sim);
    this.material = createGrayboxMaterial();
    this.root = new Group();
    this.root.name = 'graybox';
    for (const sim of this.sim) {
      const mesh = buildChunkMesh(sim, this.render.find((r) => r.key === sim.key) ?? null);
      if (meshObjectCount(mesh) > MAX_OBJECTS_PER_CHUNK) throw new Error(`gray-box chunk ${sim.key} needs ${meshObjectCount(mesh)} render objects`);
      this.meshes.push(mesh);
      this.root.add(chunkGroup(mesh, this.material));
    }
  }

  addTo(scene: Pick<Scene, 'add' | 'remove'>): void {
    this.scene = scene;
    scene.add(this.root);
  }

  info(): GrayboxInfo {
    const counts = this.root.children.map((g) => g.children.length);
    return {
      chunks: this.root.children.length,
      objectsPerChunk: counts,
      maxObjectsPerChunk: Math.max(0, ...counts),
      triangles: this.meshes.reduce((a, m) => a + meshTriangleCount(m), 0),
      keys: this.sim.map((c) => c.key),
    };
  }

  dispose(): void {
    this.scene?.remove(this.root);
    for (const g of this.root.children) disposeGroup(g as Group);
    this.material.dispose();
  }
}
