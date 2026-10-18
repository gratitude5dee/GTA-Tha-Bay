/**
 * C07 asset contract, version 1.1.0: spec/domains/05-assets.md section 4.2, copied without changes.
 * Only assetRefOf and objectKey are implemented here (M00b); resolveVariant stays a type-only
 * declaration until M01d. Owner: S05. Change only through the Architect.
 */
import type { QualityTierId } from '../platform/c13.ts';

export const C07_VERSION = '1.1.0' as const;            // bump with 06; additive = minor; 1.1 additions: 05-assets-pipeline.md §14

export type AssetKind =
  | 'character' | 'character_sheet' | 'rig' | 'anim' | 'portrait' | 'mouth_atlas'
  | 'vehicle' | 'prop' | 'building' | 'terrain' | 'texture' | 'ui' | 'font'
  | 'audio_music' | 'audio_sfx' | 'audio_bark' | 'voice' | 'cutscene'
  | 'map_data' | 'world_pack' | 'data';
export type AssetId = string;                            // /^[a-z0-9][a-z0-9._-]{1,62}$/
export type AssetRef = `${AssetKind}/${AssetId}`;
export type VariantId = QualityTierId | 'default';

export type Origin = 'generated' | 'authored' | 'licensed' | 'open_data' | 'derived';
export type LikenessTier = 'consented' | 'parody' | 'fictionalized' | 'original';
export type VoiceMode = 'none' | 'synthetic' | 'designed' | 'consented_clone' | 'licensed';

export interface VariantStats { tris?: number; verts?: number; bones?: number; materials?: number; primitives?: number;
  texMaxPx?: number; texGpuBytes?: number; durationS?: number; lufs?: number; truePeakDb?: number; fps?: number }

export interface AssetVariant {
  key: string;                         // object key in MEDIA; URL = `${MEDIA_ORIGIN}/${key}` (origin from config, never stored)
  sha256: string;                      // lowercase hex of stored bytes; equals ProvenanceRecord.sha256
  bytes: number;                       // ≤ 25 MiB (D-17); world_pack ≤ 4 MiB
  contentType: string;                 // model/gltf-binary | image/ktx2 | audio/ogg … (table §4.4)
  encoding: 'identity';
  codec?: { mesh?: 'meshopt' | 'none'; tex?: 'ktx2-uastc' | 'ktx2-etc1s' | 'webp' | 'png'; audio?: 'opus' | 'aac' };
  stats?: VariantStats;
}

export interface ProvenanceSummary {   // copy of the ROOT record's headline fields (full record: §4.3)
  root: string;                        // sha256 of the root ProvenanceRecord
  origin: Origin; license: string; attribution?: string;
  aiGenerated: boolean; vendor?: string; endpoint?: string; requestId?: string; promptSha256?: string;
}

export interface LikenessSummary {
  tier: LikenessTier;
  subjectId: string | null;            // opaque 'subj_…'; real-side strings never leave the server (NameRegistry)
  soulVersion?: number;
  faceReferenceUsed: boolean;          // tier !== 'consented' ⇒ false
  voiceMode: VoiceMode;                // tier !== 'consented' ⇒ none | synthetic | designed
  consentRecordId?: string;            // required when tier === 'consented'
  photoreal: boolean;                  // tier !== 'consented' ⇒ false (style preset toon-pbr only)
  standIn?: AssetRef;                  // required when tier !== 'original'; must resolve to an 'original' asset
  disclaimer: 'courtesy' | 'parody' | 'fictional' | 'none';
}

export type KindExtras =
  | { t: 'character'; npcId: string; rigFamily: 'bay_rig_v1'; heightM: number; bones: { jaw: boolean; fingers: boolean };
      animSets: AssetRef[]; portrait?: AssetRef; mouthAtlas?: AssetRef; mouthAnchor?: [number, number, number] }
  | { t: 'vehicle'; class: 'traffic' | 'race' | 'police' | 'hero'; fictionalMake: string; wheelRadiusM: number;
      nodes: { body: string; wheels: [string, string, string, string]; steer?: string[]; lights?: string[]; collider?: string } }
  | { t: 'audio'; durationS: number; lufs: number; truePeakDb: number; sampleRate: 48000; loop?: { startS: number; endS: number }; cues?: AssetRef }
  | { t: 'voice'; vendor: string; voiceId: string; endpointKey: string; mode: VoiceMode; designPromptSha256?: string };

export interface AssetManifest {       // one asset; 06 sketch {id, kind, variants, provenance, deps}
  schema: 'asset/1';
  id: AssetId; kind: AssetKind;
  rev: number;                         // +1 whenever any variant byte changes
  variants: Partial<Record<VariantId, AssetVariant>>;
  deps: AssetRef[];                    // loaded together; acyclic (CI)
  provenance: ProvenanceSummary;
  likeness?: LikenessSummary;          // REQUIRED for character, character_sheet, rig, anim, portrait, mouth_atlas, voice, audio_bark, cutscene
  status: 'active' | 'quarantined' | 'killed';   // catalogs omit non-active
  visibility: 'public' | 'private';    // private entries never appear in the public catalog
  tags: string[];                      // 'char:<npcId>' on every character-derived asset (purge index)
  extras?: KindExtras;
}

export interface AssetCatalog {        // immutable, content-addressed: manifests/assets-<sha256>.json
  schema: 'asset-catalog/1'; c07: typeof C07_VERSION; buildId: string; gitSha: string; createdAt: number /* epoch ms */;
  entries: Record<AssetRef, AssetManifest>;
}
export interface CatalogPointer {      // built into the Worker's static assets: /asset-catalog.json
  schema: 'asset-catalog-pointer/1'; sha256: string; key: string; bytes: number;
}

export declare function resolveVariant(m: AssetManifest, tier: QualityTierId): AssetVariant;  // default, else C13 VARIANT_FALLBACK[tier]; throws NO_VARIANT

const ASSET_ID_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function assetRefOf(kind: AssetKind, id: AssetId): AssetRef {
  if (!ASSET_ID_RE.test(id)) throw new Error(`invalid asset id: ${id}`);
  return `${kind}/${id}`;
}

/**
 * Physical object key `<root>/<variant>.<sha256[0:12]>.<ext>` (section 4.1). Roots: characters/<slug>/<part>/ for the
 * character family, audio/barks/<sha256>.opus for barks, cutscenes/<key>/ (no hash suffix: the key is the hash),
 * assets/<kind>/<id>/ for everything else.
 */
export function objectKey(kind: AssetKind, id: AssetId, variant: VariantId, sha256: string, ext: string): string {
  if (!ASSET_ID_RE.test(id)) throw new Error(`invalid asset id: ${id}`);
  if (!SHA256_RE.test(sha256)) throw new Error('sha256 must be 64 lowercase hex characters');
  const e = ext.replace(/^\./, '');
  const short = sha256.slice(0, 12);
  switch (kind) {
    case 'audio_bark':
      return `audio/barks/${sha256}.${e}`;
    case 'cutscene':
      return `cutscenes/${id}/${variant}.${e}`;
    case 'character':
    case 'anim':
    case 'portrait':
    case 'mouth_atlas': {
      const part = kind === 'character' ? 'model' : kind;
      const slug = kind === 'anim' ? (id.split('.')[0] ?? id) : id;
      return `characters/${slug}/${part}/${variant}.${short}.${e}`;
    }
    default:
      return `assets/${kind}/${id}/${variant}.${short}.${e}`;
  }
}
