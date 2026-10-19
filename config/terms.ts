/**
 * The one owner of TERMS_VERSION (M00e, DL-602) and the interim Terms and Privacy documents served by route 66.
 * M04b1 and M13d2 replace the document content and keep this constant, bumping its value when the text changes.
 * Imported by services/edge (the recorded exception in eslint.config.js) and by tests; text holds `{brand}` and
 * `{contact}` placeholders, never the display name.
 */
import type { LegalDocRes } from '../packages/shared/src/api/legal.ts';
import privacyJson from '../content/legal/privacy.json' with { type: 'json' };
import termsJson from '../content/legal/terms.json' with { type: 'json' };

export const TERMS_VERSION = 'interim-1';

// The JSON files hold the text; `version` comes from the constant so the two cannot drift.
export const TERMS_DOC: LegalDocRes = { ...(termsJson as Omit<LegalDocRes, 'version'>), version: TERMS_VERSION };
export const PRIVACY_DOC: LegalDocRes = { ...(privacyJson as Omit<LegalDocRes, 'version'>), version: TERMS_VERSION };

export const LEGAL_DOCS_BY_NAME: Readonly<Record<'terms' | 'privacy', LegalDocRes>> = {
  terms: TERMS_DOC,
  privacy: PRIVACY_DOC,
};
