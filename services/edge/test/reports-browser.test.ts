import { describe, expect, it } from 'vitest';
import { aeStub, call, ISOLATION } from './helpers.ts';

const cspReport = {
  type: 'csp-violation',
  age: 12,
  url: 'https://example.test/play?token=secret',
  body: {
    documentURL: 'https://example.test/play?token=secret',
    effectiveDirective: 'script-src-elem',
    blockedURL: 'https://evil.example/x.js?k=1',
    disposition: 'report',
  },
};

describe('route 4: browser reports (AC-11)', () => {
  it('answers 204 to a Reporting API csp-violation body and stores only the directive, origin and path', async () => {
    const ae = aeStub();
    const res = await call('/api/v1/reports/browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/reports+json' },
      body: JSON.stringify([cspReport]),
      env: { AE: ae.dataset, BUILD_ID: 'b-1' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0]).toMatchObject({ indexes: ['csp-violation'], blobs: ['script-src-elem', 'https://evil.example', '/play', 'report', 'b-1'] });
    expect(JSON.stringify(ae.points)).not.toContain('secret');
    expect(JSON.stringify(ae.points)).not.toContain('k=1');
  });

  it('accepts the legacy csp-report object and ignores other report types', async () => {
    const ae = aeStub();
    const legacy = { 'csp-report': { 'document-uri': 'https://example.test/', 'effective-directive': 'img-src', 'blocked-uri': 'inline', disposition: 'report' } };
    const a = await call('/api/v1/reports/browser', { method: 'POST', body: JSON.stringify(legacy), env: { AE: ae.dataset } });
    expect(a.status).toBe(204);
    const b = await call('/api/v1/reports/browser', { method: 'POST', body: JSON.stringify([{ type: 'network-error', body: { type: 'dns.unreachable' } }]), env: { AE: ae.dataset } });
    expect(b.status).toBe(204);
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0]?.blobs?.slice(0, 3)).toEqual(['img-src', 'inline', '/']);
  });

  it('is geo-gated like other public routes; rejects non-JSON and oversize bodies', async () => {
    expect((await call('/api/v1/reports/browser', { method: 'POST', body: '[]', country: 'DE' })).status).toBe(451);
    expect((await call('/api/v1/reports/browser', { method: 'POST', body: 'nope' })).status).toBe(400);
    expect((await call('/api/v1/reports/browser', { method: 'POST', body: 'x'.repeat(20 * 1024) })).status).toBe(413);
  });

  it('a Worker response carries the isolation headers and the Report-Only policy', async () => {
    const res = await call('/api/v1/reports/browser', { method: 'POST', body: JSON.stringify([cspReport]) });
    for (const [h, v] of Object.entries(ISOLATION)) expect(res.headers.get(h)).toBe(v);
    expect(res.headers.get('content-security-policy-report-only')).toContain("default-src 'self'");
    expect(res.headers.get('reporting-endpoints')).toBe(
      'csp="/api/v1/reports/browser", crash-reporting="/api/v1/reports/browser", default="/api/v1/reports/browser"',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});
