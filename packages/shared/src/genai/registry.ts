/**
 * genAI endpoint registry types: EndpointEntry and GenAiRegistry are spec/domains/05-assets.md section 4.5
 * verbatim; VideoProviderEntry is the config sketch of research/gap-video-model-licence-clearance.md section 8.
 * registryFindings() holds the invariants that check:assets enforces on config/genai-endpoints.json.
 */
import type { LikenessTier } from '../assets/c07.ts';

export interface EndpointEntry {
  id: string;                                   // exact vendor id, e.g. 'meshy/v7.1/multi-image-to-3d'
  vendor: 'fal' | 'workers_ai' | 'elevenlabs' | 'anthropic' | 'local';
  role: 'style_bible' | 'sheet' | 'sheet_lean' | 'keyframe' | 'portrait' | 'mesh' | 'mesh_alt' | 'rig'
      | 'tts_draft' | 'tts_final' | 'tts_hero' | 'voice_design' | 'voice_clone' | 'sfx' | 'vision_qa';
  status: 'active' | 'pending' | 'blocked';     // blocked => callable only with env 'previs'
  price: { usd: number; per: 'image' | 'gen' | 'second' | 'clip' | '1k_chars' | 'voice'; note?: string; checkedAt: string };
  pinnedUpdatedAt: string | null;               // registry updated_at at last review; enters job keys
  licenseType: 'commercial';                    // liveness fails on any other value
  tiers: LikenessTier[];                        // tiers allowed to call it
  acceptsFaceRefs: boolean;                     // true only on consented paths
  termsSnapshot: string;                        // docs/legal/vendor-terms/<vendor>-<date>.md
}

export type LicenceStatus = 'cleared' | 'pending' | 'blocked';

export interface VideoProviderEntry {
  key: 'h3.partner' | 'h3.maxTurbo' | 'h3.max' | 'ltx25.fast' | 'gemini.omniFlash11' | 'kling.o3pro';
  endpoints: { i2v?: string; ref2v?: string; extend?: string };
  caps: { minS: number; maxS: number; res: string[]; firstLastFrame: boolean; maxRefImages: number; nativeAudio: boolean };
  licence: { gate: 'ADR-GENAI-01'; status: LicenceStatus; usCommercialOutputs: boolean | 'unknown';
    under18Audience: 'allowed' | 'forbidden' | 'unknown'; endUserMode: 'internal-pipeline-only' | 'customer-solution';
    duties: { uiCredit?: string; perClipAiLabel: true; keepC2pa: boolean; visibleMark?: boolean };
    evidence: { url: string; termsSnapshotSha256: string; checkedAt: string; confirmationPath?: string }[] };
  price: { usdPerS: number; resolution: string; checkedAt: string };
}

export interface GenAiRegistry {
  schema: 'genai-endpoints/1'; checkedAt: string;
  endpoints: Record<string, EndpointEntry>;
  videoProviders: Record<string, VideoProviderEntry>;   // shape and assertCallable: research/gap-video-model-licence-clearance.md section 8
  banned: { id: string; match: 'exact' | 'prefix'; reason: string }[];
  defaults: { videoProvider: string; videoFallbackOrder: string[] };
}

export interface RegistryFinding { rule: string; detail: string }

/** Ban entries every registry must carry (section 4.5 "Banned"). The face-swap rule is a substring rule. */
export const REQUIRED_BANS: readonly { id: string; match: 'exact' | 'prefix' }[] = [
  { id: 'minimax/h3-max/recast', match: 'exact' },
  { id: 'face-swap', match: 'prefix' },
  { id: 'bytedance/seedance-2.5/image-to-video', match: 'exact' },
  { id: 'fal-ai/veo3', match: 'prefix' },
];

/** True when `id` is banned by the registry's list (`face-swap` matches anywhere in the id). */
export function isBannedEndpoint(reg: Pick<GenAiRegistry, 'banned'>, id: string, role?: EndpointEntry['role']): boolean {
  for (const b of reg.banned) {
    if (b.id === 'face-swap') {
      if (id.includes('face-swap')) return true;
    } else if (b.match === 'exact' && b.id === id) return true;
    else if (b.match === 'prefix' && id.startsWith(b.id)) return true;
  }
  return id.endsWith('/voice-clone') && role !== 'voice_clone';
}

export function registryFindings(reg: GenAiRegistry): RegistryFinding[] {
  const out: RegistryFinding[] = [];
  for (const need of REQUIRED_BANS) {
    if (!reg.banned.some((b) => b.id === need.id && b.match === need.match)) {
      out.push({ rule: 'banned-missing', detail: `banned list lacks ${need.match} ${need.id}` });
    }
  }
  const clone = Object.values(reg.endpoints).filter((e) => e.role === 'voice_clone');
  if (clone.length === 0) out.push({ rule: 'voice-clone-missing', detail: 'no endpoint with role voice_clone' });
  for (const e of clone) {
    if (e.tiers.length !== 1 || e.tiers[0] !== 'consented') {
      out.push({ rule: 'voice-clone-tiers', detail: `${e.id}: voice_clone must allow only the consented tier` });
    }
  }
  for (const [key, e] of Object.entries(reg.endpoints)) {
    if (e.id !== key) out.push({ rule: 'key-mismatch', detail: `${key}: entry id is ${e.id}` });
    if (e.status === 'active' && isBannedEndpoint(reg, e.id, e.role)) {
      out.push({ rule: 'banned-endpoint-active', detail: `${e.id} is banned but registered as active` });
    }
    if (e.acceptsFaceRefs && e.tiers.some((t) => t !== 'consented')) {
      out.push({ rule: 'face-refs-tiers', detail: `${e.id}: acceptsFaceRefs requires tiers [consented]` });
    }
  }
  for (const [key, p] of Object.entries(reg.videoProviders)) {
    if (p.licence.status === 'cleared') {
      out.push({ rule: 'video-provider-cleared', detail: `${key}: no provider may be cleared before ADR-GENAI-01 evidence exists` });
    }
  }
  for (const k of [reg.defaults.videoProvider, ...reg.defaults.videoFallbackOrder]) {
    if (!(k in reg.videoProviders)) out.push({ rule: 'video-default-unknown', detail: `defaults name unknown provider ${k}` });
  }
  return out;
}
