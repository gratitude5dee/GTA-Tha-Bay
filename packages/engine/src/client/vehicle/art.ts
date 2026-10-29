/**
 * The art kit of the vehicle and prop models (M10d1): where the object pool and the world's renderers get the decoded model of an asset
 * ref, the look profile the materials follow and the material factory. A module-level store, like the reflect hook of `vehicle-view.ts`:
 * the world installs a loader (asset.worker job `world.vehicle`), a profile and a material factory when it attaches, and the engine knows
 * nothing of the world. Until a model has arrived `get` returns null and the pool draws the gray-box stand-in.
 */
import { MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import type { ArtModelData } from './art-model.ts';

/** The look profile the materials follow: `full` physical paint, `lite` and `min` standard paint, `legacy` vertex colour. */
export type ArtProfile = 'full' | 'lite' | 'min' | 'legacy';

/** Loads the model of `ref` at the variant of `tier` (`desktop`, `mobile`, `mobile-low`); null when the catalog has none. */
export type ArtLoader = (ref: string, variant: 'desktop' | 'mobile' | 'mobile-low') => Promise<ArtModelData | null>;

export interface ArtMaterialFactory {
  /** One shared material for the opaque primitives (`pass: 'opaque'`) and one for glass; null leaves the default. */
  make(pass: 'opaque' | 'glass'): Material;
}

export interface ArtStatus {
  profile: ArtProfile;
  variant: 'desktop' | 'mobile' | 'mobile-low';
  loaded: string[];
  pending: string[];
  failed: string[];
}

/** The default factory: vertex colours on a standard material, glass translucent. Used until the world installs the TSL one. */
const defaultFactory: ArtMaterialFactory = {
  make(pass) {
    if (pass === 'glass') return new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.6 });
    return new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
  },
};

class ArtStore {
  private loader: ArtLoader | null = null;
  private factory: ArtMaterialFactory = defaultFactory;
  private readonly models = new Map<string, ArtModelData>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private profileValue: ArtProfile = 'legacy';
  private variantValue: 'desktop' | 'mobile' | 'mobile-low' = 'desktop';
  private materials = new Map<'opaque' | 'glass', Material>();
  /** Counts arrivals: a holder of gray-box stand-ins swaps them when it changes. */
  version = 0;

  get profile(): ArtProfile {
    return this.profileValue;
  }

  get variant(): 'desktop' | 'mobile' | 'mobile-low' {
    return this.variantValue;
  }

  /** Installs the loader, the profile and the variant of the tier; clears the models of a previous world. */
  configure(o: { loader: ArtLoader | null; profile: ArtProfile; variant: 'desktop' | 'mobile' | 'mobile-low'; factory?: ArtMaterialFactory | null }): void {
    this.loader = o.loader;
    this.profileValue = o.profile;
    this.variantValue = o.variant;
    this.factory = o.factory ?? defaultFactory;
    this.models.clear();
    this.inflight.clear();
    this.failed.clear();
    this.disposeMaterials();
    this.version++;
    this.emit();
  }

  /** Drops the loader and the models (the world's layer was disposed). */
  reset(): void {
    this.configure({ loader: null, profile: 'legacy', variant: 'desktop' });
  }

  get(ref: string): ArtModelData | null {
    return this.models.get(ref) ?? null;
  }

  /** Puts a model in directly (tests, and the traffic renderer that has loaded it for its own use). */
  set(ref: string, model: ArtModelData): void {
    this.models.set(ref, model);
    this.version++;
    this.emit();
  }

  /** Starts loading `ref` unless it is loaded, loading or failed. */
  request(ref: string): void {
    if (this.loader === null || this.models.has(ref) || this.inflight.has(ref) || this.failed.has(ref)) return;
    const p = this.loader(ref, this.variantValue).then(
      (m) => {
        this.inflight.delete(ref);
        if (m) this.models.set(ref, m);
        else this.failed.add(ref);
        this.version++;
        this.emit();
      },
      () => {
        this.inflight.delete(ref);
        this.failed.add(ref);
        this.version++;
        this.emit();
      },
    );
    this.inflight.set(ref, p);
  }

  /** The shared material of a pass (made by the installed factory on first use). */
  material(pass: 'opaque' | 'glass'): Material {
    let m = this.materials.get(pass);
    if (!m) {
      m = this.factory.make(pass);
      this.materials.set(pass, m);
    }
    return m;
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  }

  status(): ArtStatus {
    return { profile: this.profileValue, variant: this.variantValue, loaded: [...this.models.keys()].sort(), pending: [...this.inflight.keys()].sort(), failed: [...this.failed].sort() };
  }

  private emit(): void {
    for (const f of [...this.listeners]) f();
  }

  private disposeMaterials(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}

export const art = new ArtStore();
