/**
 * C10 NPC builder contract, version 1.0.0: spec/domains/04-npc-builder.md section C3, copied without shape changes.
 * Imports use the .ts extension. Owner: S04. Change only through the Architect.
 */
import type { AssetRef } from '../assets/c07.ts';
import type { DistrictId } from '../world/c08.ts';
import { C10_VERSION } from './c10-npc.ts';
import type { Archetype, CompiledSoulPublic, NpcId, SoulFrontmatter } from './c10-npc.ts';

export { C10_VERSION };

export type DraftState = 'draft' | 'validating' | 'rejected_auto' | 'text_ok' | 'soul_generating' | 'soul_failed' | 'soul_ready'
  | 'probing' | 'private' | 'in_review' | 'published' | 'unpublished_pending_review' | 'rejected' | 'removed' | 'killed';
export type Attestation = 'original';                 // 'self' | 'consented_real' reserved, not accepted in v1
export interface DraftFields { name: string; shortBio: string; archetype: Archetype; tags: string[]; district: DistrictId;
  voiceRef: AssetRef | null; appearancePreset: string | null /* S10 creator preset id */ }
export type Verdict = 'allow' | 'review' | 'block' | 'quarantine';
export interface LintIssue { rule: string /* 'schema' | 'L1'… */; path: string; message: string }
export interface DraftView {
  id: string; npcId: NpcId; rev: number; state: DraftState; fields: DraftFields; backstoryChars: number;
  images: { uploadId: string; state: 'scanning' | 'described' | 'review' | 'blocked' | 'quarantined'; description: string | null }[];
  moderation: { text: Verdict | null; images: Verdict | null; realPerson: 'none' | 'possible' | 'explicit'; publishable: boolean; reasons: string[] };
  soul: { frontmatter: SoulFrontmatter; sections: Record<string, string> } | null; lint: LintIssue[];
  probes: { passed: number; total: 5; failures: string[] } | null;
  publish: { soulVersion: number | null; caseId: string | null; notes: string | null };
  jobs: { id: string; kind: 'validate' | 'soul' | 'images' | 'assets'; state: 'queued' | 'running' | 'done' | 'failed' }[];
  limits: { soulGenerationsLeft: number; previewTurnsLeft: number };
}
export interface CreateDraftReq { fields: DraftFields; attestation: Attestation }
export interface UpdateDraftReq { rev: number; fields?: Partial<DraftFields>; backstory?: string;
  soulEdits?: { frontmatter?: Partial<Pick<SoulFrontmatter, 'shortBio' | 'speech' | 'personality' | 'schedule' | 'goals' | 'visual_brief' | 'rails'>>; sections?: Record<string, string> } }
export interface AttachImagesReq { uploadIds: string[] }       // ≤ 6 total per draft
export interface JobAccepted { jobId: string; state: 'queued' }
export interface SubmitRes { caseId: string }
export interface CommunityNpc { npcId: NpcId; soulVersion: number; name: string; shortBio: string; archetype: Archetype;
  district: DistrictId; publishedAt: number; soul: CompiledSoulPublic }
