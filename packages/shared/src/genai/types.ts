/**
 * Job, gate and key types: spec/domains/05-assets.md section 4.6, copied (C07 1.1). Types only; `jobKey` is in job-key.ts.
 * The ports a job runs over (GenPorts) belong to services/pipeline, which imports these types.
 */
import type { AssetRef, LikenessTier } from '../assets/c07.ts';

export type GenKind = 'style_bible' | 'sheet' | 'portrait' | 'mouth_atlas' | 'mesh' | 'rig' | 'voice_design' | 'tts'
  | 'keyframe' | 'cutscene_shot' | 'texture' | 'sfx';       // local-only steps (crops, retarget, optimize) are tools/assets commands

export interface InputFile {
  role: string; sha256: string;
  origin: 'first_party_generated' | 'first_party_authored' | 'consented_photo' | 'user_upload'; realHumanVisible: boolean;
}

export interface GenJob {
  schema: 'genjob/1'; jobKey: string; kind: GenKind; endpointKey: string;
  env: 'production' | 'previs' | 'test';
  subject: { assetRef: AssetRef; npcId?: string; soulVersion?: number };   // NO tier field (decision 4)
  params: Record<string, unknown>;       // vendor parameters; file inputs referenced by InputFile.sha256, presigned at submit
  inputs: InputFile[]; promptTemplate: `${string}@${number}`; promptSha256: string;
  budgetUsdMicros: number; runId?: string; requestedBy: string;   // integer USD micros, the unit of S09's ledger
}

export interface JobKeyInput {
  kind: GenKind; endpointId: string; pinnedUpdatedAt: string | null; params: Record<string, unknown>;
  inputSha256: string[]; promptTemplate: string; promptSha256: string; soulVersion?: number; tier?: LikenessTier; recipe: string;
}

export type GateCode = 'TIER_UNKNOWN' | 'KILLED' | 'FACE_REF_FORBIDDEN' | 'CLONE_FORBIDDEN' | 'NAME_IN_PROMPT'
  | 'PHOTOREAL_FORBIDDEN' | 'CONSENT_EXPIRED' | 'ENDPOINT_BANNED' | 'ENDPOINT_NOT_CLEARED' | 'KILL_SWITCH' | 'BUDGET' | 'MINOR_SUSPECTED' | 'POLICY_REFUSED';

export type GateVerdict = { ok: true } | { ok: false; code: GateCode; detail: string };
