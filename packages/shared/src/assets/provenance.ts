/**
 * Provenance record `provenance/1.0`: spec/domains/05-assets.md section 4.3, copied without changes
 * (JSON on disk, snake_case). The JSON Schema is packages/shared/schemas/provenance-1.0.schema.json.
 */
import type { AssetKind, LikenessTier, Origin, VoiceMode } from './c07.ts';

export interface ProvenanceRecord {
  schema: 'provenance/1.0';
  sha256: string; paths: string[];                       // repo or catalog paths that resolve to these bytes
  kind: AssetKind; origin: Origin;
  license: string;                                       // SPDX or LicenseRef-*; allowlist in config/license-allowlist.json
  attribution?: string; authors: string[];               // 'profile:…' | 'studio:…'
  source?: { url: string | null; dataset_id: string | null; retrieved: string };      // licensed / open_data
  generator?: {                                          // REQUIRED when origin is 'generated'
    vendor: 'fal' | 'elevenlabs' | 'minimax' | 'openai' | 'workers_ai' | 'anthropic' | 'local';
    endpoint: string; endpoint_registry_key: string; endpoint_updated_at: string | null; model_version?: string;
    request_id: string; seed?: number; job_key: string; params_sha256: string;
    prompt_template: string; prompt_sha256: string; negative_prompt_sha256?: string; expanded_prompt_sha256?: string;
    input_refs: string[];                                // 'sha256:<hex>' of every input file, never URLs
    plan?: string;                                       // vendor plan tier when terms depend on it (music)
    terms_snapshot: { path: string; sha256: string; checked_at: string };
    licence_gate?: { gate: 'ADR-GENAI-01'; status: 'cleared' | 'pending' | 'blocked'; evidence?: string };
    cost_usd_micros?: number; generated_at: string;
    executor: 'workflow' | 'cli' | 'mock'; env: 'production' | 'previs' | 'test';
  };
  derived_from: string[];                                // parent sha256s (retopo, LODs, KTX2, transcodes)
  tool?: { name: string; version: string; args_sha256: string };                       // for origin 'derived'
  likeness?: { subject_id: string | null; tier: LikenessTier; face_reference_used: boolean; voice_mode: VoiceMode;
               consent_record_id?: string; consent_scopes_used?: string[]; photoreal: boolean };
  review: { gate: string; by: string; at: string; decision: 'approve' | 'reject'; note?: string }[];
  ip_checks: { signatures: 'pass' | 'n/a'; strings: 'pass' | 'n/a'; similarity: 'pass' | 'n/a'; vision?: 'pass' | 'review' };
  ai_generated: boolean; c2pa?: 'valid' | 'valid-untrusted' | 'absent' | 'invalid' | 'resigned';
  status: 'active' | 'quarantined' | 'killed'; created_at: string; // all ProvenanceRecord timestamps: ISO-8601 UTC 'Z' (06 §4.3 exception, DL-059)
}
