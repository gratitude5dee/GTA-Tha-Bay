import { describe, expect, it } from 'vitest';
import { buildCspReportOnly, REPORTING_ENDPOINTS } from '../src/index.ts';

const hosts = { media: 'https://media.example.com', ugc: 'https://ugc.example.com', rt: 'https://rt.example.com', id: 'https://id.example.com' };

describe('buildCspReportOnly', () => {
  it('matches the directive set of spec/05 section 1.3', () => {
    const csp = buildCspReportOnly({ ...hosts, accountId: 'acct123' });
    expect(csp).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://media.example.com https://ugc.example.com",
        "media-src 'self' blob: https://media.example.com",
        "font-src 'self'",
        "worker-src 'self' blob:",
        "connect-src 'self' https://media.example.com https://ugc.example.com https://rt.example.com wss://rt.example.com https://id.example.com https://acct123.r2.cloudflarestorage.com",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'report-to csp',
      ].join('; '),
    );
  });

  it('omits the R2 endpoint without an account id and names only our own origins', () => {
    const csp = buildCspReportOnly(hosts);
    expect(csp).not.toContain('r2.cloudflarestorage.com');
    expect(csp).not.toMatch(/https?:\/\/(?!(media|ugc|rt|id)\.example\.com)[a-z]/);
  });

  it('points the Reporting-Endpoints group at route 4', () => {
    expect(REPORTING_ENDPOINTS).toBe('csp="/api/v1/reports/browser"');
  });
});
