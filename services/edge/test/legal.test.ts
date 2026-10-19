import { describe, expect, it } from 'vitest';
import type { LegalDocRes } from '@dv/shared';
import { DISPLAY_NAME } from '../../../config/brand.ts';
import { TERMS_VERSION } from '../../../config/terms.ts';
import { call } from './helpers.ts';

const text = (doc: LegalDocRes): string => doc.sections.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n');

describe('route 66: GET /api/v1/legal/:doc', () => {
  it('serves terms and privacy from FR with the TERMS_VERSION and no display-name literal', async () => {
    for (const doc of ['terms', 'privacy'] as const) {
      const res = await call(`/api/v1/legal/${doc}`, { country: 'FR', env: { LEGAL_CONTACT: 'privacy@example.test' } });
      expect(res.status, doc).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as LegalDocRes;
      expect(body.doc).toBe(doc);
      expect(body.version).toBe(TERMS_VERSION);
      expect(body.counselReviewed).toBe(false);
      expect(typeof body.updated).toBe('number');
      expect(text(body)).not.toContain(DISPLAY_NAME);
      expect(text(body)).toContain('{brand}');
    }
  });

  it('keeps the M00a placeholder for other documents and methods, never 451', async () => {
    const other = await call('/api/v1/legal/other', { country: 'FR' });
    expect(other.status).toBe(404);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe('feature_disabled');
    const post = await call('/api/v1/legal/dmca', { method: 'POST', country: 'FR', body: '{}' });
    expect(post.status).toBe(404);
    const postTerms = await call('/api/v1/legal/terms', { method: 'POST', country: 'FR', body: '{}' });
    expect(postTerms.status).toBe(404);
    expect((await call('/api/v1/legal', { country: 'FR' })).status).toBe(404);
  });

  it('puts LEGAL_CONTACT into the privacy text, or a neutral line and no placeholder without it', async () => {
    const withContact = (await (await call('/api/v1/legal/privacy', { env: { LEGAL_CONTACT: 'privacy@example.test' } })).json()) as LegalDocRes;
    expect(text(withContact)).toContain('privacy@example.test');
    expect(text(withContact)).not.toContain('{contact}');
    const without = (await (await call('/api/v1/legal/privacy', { env: { LEGAL_CONTACT: undefined } })).json()) as LegalDocRes;
    expect(text(without)).not.toContain('{contact}');
    expect(text(without)).toContain('contact to be published before release');
    const blank = (await (await call('/api/v1/legal/terms', { env: { LEGAL_CONTACT: '   ' } })).json()) as LegalDocRes;
    expect(text(blank)).toContain('contact to be published before release');
  });

  it('the privacy text covers what is stored, the processor, deletion, export and the 30-day answer', async () => {
    const privacy = (await (await call('/api/v1/legal/privacy')).json()) as LegalDocRes;
    const t = text(privacy);
    for (const needle of ['Username', 'password hash', '18p', 'Supabase Auth', 'deletion', '30 days']) {
      expect(t.toLowerCase(), needle).toContain(needle.toLowerCase());
    }
  });
});
