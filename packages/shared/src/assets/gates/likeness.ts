/**
 * Pure core of likeness:gate (spec/domains/05-assets.md section 4.3 conditionals, 05-assets-pipeline.md section 9):
 * tier rules on provenance records, consent index coverage and expiry, face-detector strings.
 * No clock: callers pass `nowIso` (ISO-8601 UTC, as in provenance records).
 */
import type { AssetKind, LikenessSummary } from '../c07.ts';
import type { ProvenanceRecord } from '../provenance.ts';
import { finding, type GateFinding } from './types.ts';

const GATE = 'likeness:gate';

export interface ConsentEntry {
  id: string;
  subject_id: string | null;
  scopes: string[];
  /** ISO-8601 UTC end of the consent term; null means open-ended. */
  term_end: string | null;
}

export interface ConsentIndex { schema: 'consent-index/1'; entries: ConsentEntry[] }

export const LIKENESS_REQUIRED_KINDS: readonly AssetKind[] = [
  'character', 'character_sheet', 'rig', 'anim', 'portrait', 'mouth_atlas', 'voice', 'audio_bark', 'cutscene',
];

function fullIso(s: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
}

/** True when `a` is strictly earlier than `b` (both ISO-8601 UTC strings of the same shape). */
export function isoBefore(a: string, b: string): boolean {
  return fullIso(a) < fullIso(b);
}

export function checkLikenessRecord(rec: ProvenanceRecord, index: ConsentIndex, nowIso: string): GateFinding[] {
  const out: GateFinding[] = [];
  const file = rec.paths[0] ?? rec.sha256;
  const add = (rule: string, detail: string): void => {
    out.push(finding(GATE, file, rule, detail));
  };
  const l = rec.likeness;
  if (!l) {
    if (LIKENESS_REQUIRED_KINDS.includes(rec.kind)) add('likeness-missing', `kind ${rec.kind} requires a likeness block`);
    return out;
  }
  if (l.tier !== 'consented') {
    if (l.face_reference_used) add('likeness-face-ref', `tier ${l.tier} must not use a face reference`);
    if (l.photoreal) add('likeness-photoreal', `tier ${l.tier} must not be photoreal`);
    if (l.voice_mode !== 'none' && l.voice_mode !== 'synthetic' && l.voice_mode !== 'designed') {
      add('likeness-voice-mode', `tier ${l.tier} must not use voice mode ${l.voice_mode}`);
    }
    return out;
  }
  if (!l.consent_record_id) {
    add('likeness-consent-missing', 'tier consented requires consent_record_id');
    return out;
  }
  const entry = index.entries.find((e) => e.id === l.consent_record_id);
  if (!entry) {
    add('likeness-consent-unknown', `consent record ${l.consent_record_id} is not in the consent index`);
    return out;
  }
  if (entry.term_end !== null && isoBefore(entry.term_end, nowIso)) {
    add('likeness-consent-expired', `consent ${entry.id} ended ${entry.term_end}`);
  }
  for (const scope of l.consent_scopes_used ?? []) {
    if (!entry.scopes.includes(scope)) add('likeness-scope', `scope ${scope} is not covered by consent ${entry.id}`);
  }
  return out;
}

/** Catalog-side invariant of LikenessSummary: every tier except original needs a stand-in asset. */
export function checkLikenessSummary(ref: string, l: LikenessSummary): GateFinding[] {
  const out: GateFinding[] = [];
  if (l.tier !== 'original' && !l.standIn) out.push(finding(GATE, ref, 'likeness-standin-missing', `tier ${l.tier} requires standIn`));
  if (l.tier !== 'consented' && l.faceReferenceUsed) out.push(finding(GATE, ref, 'likeness-face-ref', `tier ${l.tier} must not use a face reference`));
  if (l.tier === 'consented' && !l.consentRecordId) out.push(finding(GATE, ref, 'likeness-consent-missing', 'tier consented requires consentRecordId'));
  return out;
}

/** Face-detector model strings anywhere in shipped or tracked text. `terms` come from config/ip-denylist.json. */
export function scanFaceDetector(path: string, text: string, terms: readonly string[]): GateFinding[] {
  const lower = text.toLowerCase();
  const out: GateFinding[] = [];
  for (const t of terms) {
    if (t && lower.includes(t.toLowerCase())) out.push(finding(GATE, path, 'face-detector', `contains ${t}`));
  }
  return out;
}
