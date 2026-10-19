/**
 * The post stack's node lists (M02e, DL-704). Pure, so the unit tests run in Node: C13 `TierFeatures` plus the governor's
 * `postLevel` give the ordered list of `PostNode`s to run. The level semantics are an engine rule over the existing C13 field, not a
 * contract change, and they are the ones M11a1's governor drives:
 *
 *  - level 2: the tier's `post` list as it is;
 *  - level 1: level 2 without `gtao-half`;
 *  - level 0: level 1 without `bloom`, and `traa` or `smaa` replaced by `fxaa` (the research knob order: GTAO first, then bloom,
 *    then the AA mode [research/stack-rendering-platform.md section 6.4]);
 *  - level 3: level 2 plus `optionalPost`: an optional AA node replaces the tier's AA node (never a second AA node), other optional
 *    nodes go in front of the AA node (the order is gtao, bloom, AA, tonemap), and `fsr1` goes last (it upscales the final image).
 *
 * The effective level is `min(postLevel, cap)`; the cap is `look.json` `postLevelCap` (2 until the governor lifts it). A `direct`
 * pipeline (XR) has no post stack and returns `[]`.
 */
import type { PostNode, TierFeatures } from '@dv/shared';

export type PostLevel = 0 | 1 | 2 | 3;
export type BackendName = 'webgpu' | 'webgl2';

const AA_NODES: readonly PostNode[] = ['traa', 'smaa', 'fxaa'];
const isAa = (n: PostNode): boolean => AA_NODES.includes(n);

export const effectivePostLevel = (postLevel: PostLevel, cap: PostLevel): PostLevel => (Math.min(postLevel, cap) as PostLevel);

export function postNodes(features: Pick<TierFeatures, 'post' | 'optionalPost' | 'pipeline'>, postLevel: PostLevel, cap: PostLevel = 2): PostNode[] {
  if (features.pipeline === 'direct') return [];
  const level = effectivePostLevel(postLevel, cap);
  let out: PostNode[] = [...features.post];
  if (level === 3) {
    const optional = features.optionalPost;
    const optAa = optional.find(isAa);
    if (optAa) out = out.map((n) => (isAa(n) ? optAa : n));
    const before = optional.filter((n) => !isAa(n) && n !== 'fsr1' && n !== 'tonemap' && !out.includes(n));
    // The canonical order is gtao, bloom, the AA node, tonemap: other optional nodes go in front of the AA node (or of tonemap).
    const aa = out.findIndex(isAa);
    const at = aa >= 0 ? aa : out.indexOf('tonemap');
    out.splice(at < 0 ? out.length : at, 0, ...before);
    if (optional.includes('fsr1') && !out.includes('fsr1')) out.push('fsr1');
    return out;
  }
  if (level <= 1) out = out.filter((n) => n !== 'gtao-half');
  if (level === 0) {
    out = out.filter((n) => n !== 'bloom');
    out = out.map((n) => (n === 'traa' || n === 'smaa' ? 'fxaa' : n));
  }
  return out;
}

/** What `look.json` says about the WebGL2 backend: nodes that fail there and AA substitutions. */
export interface BackendSubstitutions {
  webgl2Unsupported: readonly PostNode[];
  webgl2AaFallback: Partial<Record<'traa' | 'smaa', 'smaa' | 'fxaa'>>;
}

/**
 * The list a backend actually runs: on `webgl2` only, a node in `webgl2Unsupported` is skipped and an AA node in `webgl2AaFallback`
 * is replaced by its substitute. Never drops `tonemap` or an AA node (an AA node only changes to another one).
 */
export function adaptForBackend(nodes: readonly PostNode[], backend: BackendName, subs: BackendSubstitutions): PostNode[] {
  if (backend !== 'webgl2') return [...nodes];
  const out: PostNode[] = [];
  for (const n of nodes) {
    if (n !== 'tonemap' && !isAa(n) && subs.webgl2Unsupported.includes(n)) continue;
    let node: PostNode = n;
    for (let hop = 0; hop < 2; hop++) {
      const sub = node === 'traa' || node === 'smaa' ? subs.webgl2AaFallback[node] : undefined;
      if (!sub) break;
      node = sub;
    }
    // Never two AA nodes in a row after a substitution.
    if (isAa(node) && out.some(isAa)) continue;
    out.push(node);
  }
  return out;
}
