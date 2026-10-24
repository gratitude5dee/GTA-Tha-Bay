/**
 * The post stack (M02e, DL-704): a `RenderPipeline` built from the C13 `TierFeatures` data for the current tier, rebuilt on a tier
 * change, on a `postLevel` change and in `onRendererReplaced`.
 *
 * The scene is two passes (M02b1): the backdrop pass (sky dome, far ring) and the world pass (the city, with its own near and far
 * planes). Here the world pass renders into a colour target cleared to alpha 0, the backdrop pass into another, and the pipeline
 * composites `world + backdrop x (1 - world.a)` in linear HDR before the nodes run. GTAO reads only the world depth and normals, and
 * a pixel the world pass did not draw keeps an AO of 1. A node list that is only `tonemap` draws straight to the canvas through the
 * host's direct path (tone mapping in the renderer, no intermediate target): the cheapest form, for `mobile-low`.
 *
 * `shadowPasses` is the number of shadow passes the active shadow object reports (M02e `look/shadows.ts` sets it); both
 * `RenderBudgetMeter.measure` callers read it so shadow work is inside the counted budget.
 */
import { HalfFloatType, RenderPipeline, RenderTarget, Vector2, type Camera, type Object3D, type Scene, type WebGPURenderer } from 'three/webgpu';
import { mrt, normalView, output, pass, screenUV, select, texture, velocity, vec4 } from 'three/tsl';
import type { PostNode, QualityTierId, RenderBackend, TierFeatures } from '@dv/shared';
import type { GpuResourceOwner } from '../renderer-host.ts';
import { adaptForBackend, effectivePostLevel, postNodes, type BackendSubstitutions, type PostLevel } from './levels.ts';
import { createBloom, createFsr1, createFxaa, createGtao, createSmaa, createTonemap, createTraa, type PNode } from './nodes.ts';

export type StackMode = 'pipeline' | 'direct';

/** What a pipeline needs from the host at (re)build time. */
export interface PostContext {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: Camera;
  /** The backdrop pass (null where the world has none). */
  backdrop: { scene: Object3D; camera: Camera } | null;
}

export interface PostPipeline {
  render(): void;
  dispose(): void;
}

/** Builds the pipeline of a node list; the default builds the real three graph, tests pass a fake. */
export type PipelineFactory = (ctx: PostContext, nodes: readonly PostNode[], opts: { hdr: boolean }) => PostPipeline;

export interface PostStackOptions {
  context: () => PostContext;
  tier: QualityTierId;
  features: TierFeatures;
  backend: RenderBackend;
  subs: BackendSubstitutions;
  /** `look.json` `postLevelCap`. */
  cap: PostLevel;
  /** The governor's `postLevel` at the start. */
  level?: PostLevel;
  /** The host's legacy render (backdrop pass, then the world pass over it, tone mapping in the renderer). */
  direct: () => void;
  factory?: PipelineFactory;
  /** Called after every (re)build with the nodes now in force. */
  onBuild?: (nodes: readonly PostNode[], mode: StackMode) => void;
}

const v4 = vec4 as unknown as (...a: unknown[]) => PNode;
/** How much of the GTAO factor is applied (1 = all of it). */
const AO_STRENGTH = 0.6;


/** The real pipeline: passes, composite, the nodes in the order of the list. */
export const threePipeline: PipelineFactory = (ctx, nodes, opts) => {
  const { renderer, scene, camera, backdrop } = ctx;
  const worldPass = pass(scene, camera);
  if (!opts.hdr) {
    // A tier whose canvas is 8 bit still needs a half float target in front of the tone mapping, or highlights clip before the curve.
    const p = worldPass as unknown as { setup: (b: unknown) => unknown; renderTarget: { texture: { type: number } } };
    const setup = p.setup.bind(p);
    p.setup = (b) => {
      const r = setup(b);
      p.renderTarget.texture.type = HalfFloatType;
      return r;
    };
  }
  const wantTraa = nodes.includes('traa');
  const wantAo = nodes.includes('gtao-half');
  if (wantAo && wantTraa) worldPass.setMRT(mrt({ output, normal: normalView, velocity }));
  else if (wantAo) worldPass.setMRT(mrt({ output, normal: normalView }));
  else if (wantTraa) worldPass.setMRT(mrt({ output, velocity }));

  const world = worldPass.getTextureNode('output') as unknown as PNode;
  // The backdrop is drawn by the stack itself into a target of its own just before the pipeline renders (a pass node that renders
  // the backdrop from inside the pipeline's own render came out empty on the WebGL2 backend), and it is the world scene's background:
  // the world pass clears the depth only, so the pixels it does not draw show the backdrop and the pass output is the whole picture.
  const backdropTarget = backdrop ? new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true }) : null;
  const sky = backdropTarget ? (texture(backdropTarget.texture, screenUV) as unknown as PNode) : null;
  const size = new Vector2();
  const sceneBg = scene as unknown as { backgroundNode: unknown };
  if (sky) sceneBg.backgroundNode = v4(sky.rgb, 1);
  let color: PNode = world;
  const disposables: { dispose(): void }[] = [];

  const dbgOnly = (globalThis as { __dvPostOnly?: string }).__dvPostOnly?.split(',');
  for (const n of dbgOnly ? nodes.filter((x) => dbgOnly.includes(x)) : nodes) {
    switch (n) {
      case 'gtao-half': {
        const g = createGtao(worldPass.getTextureNode('depth'), worldPass.getTextureNode('normal'), camera);
        disposables.push(g.node);
        // The sky (nothing drawn by the world pass: the linear depth is at the far plane) keeps an AO of 1.
        const lin = (worldPass as unknown as { getLinearDepthNode(n?: string): PNode }).getLinearDepthNode('depth');
        const solid = lin.lessThan(0.9995);
        // The occlusion is softened to a multiplier of at least 0.4: the contact shading stays, and a wall seen at a grazing angle or an
        // artefact of the half resolution depth never turns a surface black.
        const soft = g.factor.r.mul(AO_STRENGTH).add(1 - AO_STRENGTH);
        const open = (select as unknown as (c: PNode, a: PNode, b: number) => PNode)(solid, soft, 1);
        color = v4(color.rgb.mul(open), 1);
        break;
      }
      case 'bloom': {
        const b = createBloom(color);
        disposables.push(b.node);
        color = v4(color.rgb.add(b.add.rgb), 1);
        break;
      }
      case 'traa':
        color = createTraa(color, worldPass.getTextureNode('depth'), worldPass.getTextureNode('velocity'), camera);
        break;
      case 'tonemap':
        color = createTonemap(color);
        break;
      case 'smaa':
        color = createSmaa(color);
        break;
      case 'fxaa':
        color = createFxaa(color);
        break;
      case 'fsr1':
        color = createFsr1(color);
        break;
    }
  }

  const pipeline = new RenderPipeline(renderer);
  // The list holds `tonemap`, so the output transform is part of the graph and runs once, before the display-referred AA nodes.
  pipeline.outputColorTransform = !nodes.includes('tonemap');
  pipeline.outputNode = color as never;
  return {
    render: () => {
      if (backdropTarget && backdrop) {
        renderer.getDrawingBufferSize(size);
        backdropTarget.setSize(size.width, size.height);
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(backdropTarget);
        renderer.render(backdrop.scene as Scene, backdrop.camera);
        renderer.setRenderTarget(prev);
      }
      pipeline.render();
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
      if (sky) sceneBg.backgroundNode = null;
      backdropTarget?.dispose();
      pipeline.dispose();
    },
  };
};

export class PostStack implements GpuResourceOwner {
  /** Shadow passes the active shadow object reports (set by the look; 0 for none, `blob` and the legacy path). */
  shadowPasses = 0;
  /** Number of times the pipeline was (re)built. */
  builds = 0;

  private readonly o: PostStackOptions;
  private tierId: QualityTierId;
  private features: TierFeatures;
  private level: PostLevel;
  private list: PostNode[] = [];
  private pipeline: PostPipeline | null = null;
  private currentMode: StackMode = 'direct';
  private disposed = false;

  constructor(o: PostStackOptions) {
    this.o = o;
    this.tierId = o.tier;
    this.features = o.features;
    this.level = o.level ?? 2;
    this.rebuild();
  }

  /** The nodes in force: the tier list at the effective level, after the backend's substitutions. */
  get nodes(): readonly PostNode[] {
    return this.list;
  }

  get mode(): StackMode {
    return this.currentMode;
  }

  get tier(): QualityTierId {
    return this.tierId;
  }

  get effectiveLevel(): PostLevel {
    return effectivePostLevel(this.level, this.o.cap);
  }

  /** The nodes a tier would run at a level on this backend (pure; what `rebuild` uses). */
  listFor(features: TierFeatures, level: PostLevel): PostNode[] {
    return adaptForBackend(postNodes(features, level, this.o.cap), this.o.backend, this.o.subs);
  }

  /** A tier change: the next list is built from the new tier's features. */
  setTier(tier: QualityTierId, features: TierFeatures): void {
    this.tierId = tier;
    this.features = features;
    this.rebuild();
  }

  /** The governor's `postLevel` moved. A change that leaves the effective list as it was does not rebuild. */
  setLevel(level: PostLevel): void {
    if (level === this.level) return;
    const before = this.list.join(',');
    this.level = level;
    if (this.listFor(this.features, level).join(',') !== before) this.rebuild();
  }

  /** Rebuilds the pipeline from the current tier and level. */
  rebuild(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.list = this.listFor(this.features, this.level);
    const onlyTonemap = this.list.length === 0 || (this.list.length === 1 && this.list[0] === 'tonemap');
    this.currentMode = onlyTonemap ? 'direct' : 'pipeline';
    if (this.currentMode === 'pipeline') {
      const factory = this.o.factory ?? threePipeline;
      this.pipeline = factory(this.o.context(), this.list, { hdr: this.features.hdrOutput });
    }
    this.builds++;
    this.o.onBuild?.(this.list, this.currentMode);
  }

  /** One frame: through the pipeline, or the host's direct path. */
  render(): void {
    if (this.disposed) return;
    if (this.pipeline) this.pipeline.render();
    else this.o.direct();
  }

  /** Device loss or an XR swap: the pipeline holds render targets of the old device, so it is built again on the new renderer. */
  onRendererReplaced(_next: WebGPURenderer, _prev: WebGPURenderer | null): Promise<void> {
    this.rebuild();
    return Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
