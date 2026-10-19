import type { LegalDocRes } from '@dv/shared';
import { LEGAL_DOCS_BY_NAME } from '../../../../config/terms.ts';
import { apiError, json } from '../errors.ts';
import type { Ctx } from '../router.ts';

const CONTACT_FALLBACK = '(contact to be published before release)';

function withContact(doc: LegalDocRes, contact: string): LegalDocRes {
  return {
    ...doc,
    sections: doc.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map((p) => p.replaceAll('{contact}', contact)) })),
  };
}

/**
 * Route 66: GET /api/v1/legal/terms and /legal/privacy (M00e item 18). `{contact}` becomes the operator-supplied
 * LEGAL_CONTACT var. Any other document and every other method keep the M00a placeholder (route 42 lands in M13d1).
 * Geo-exempt so takedown requesters anywhere can reach it (R-IP-03).
 */
export function handleLegal({ request, url, env, requestId, deps }: Ctx): Response {
  const m = /^\/api\/v1\/legal\/(terms|privacy)$/.exec(url.pathname);
  if (m?.[1] && (request.method === 'GET' || request.method === 'HEAD')) {
    const contact = env.LEGAL_CONTACT?.trim();
    if (!contact) deps.logOnce('legal-contact', 'SKIP legal contact: LEGAL_CONTACT not set');
    return json(withContact(LEGAL_DOCS_BY_NAME[m[1] as 'terms' | 'privacy'], contact || CONTACT_FALLBACK));
  }
  return apiError('feature_disabled', 'This route is not available yet.', requestId);
}
