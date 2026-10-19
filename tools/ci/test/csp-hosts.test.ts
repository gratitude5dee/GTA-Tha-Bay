import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cspForBuild, PROD_CSP_HOSTS, STAGING_CSP_HOSTS } from '../../../config/csp-hosts.ts';
import { stripJsonc } from '../deploy.ts';
import { repoRoot } from '../run.ts';

interface Vars {
  HOST_MEDIA: string;
  HOST_UGC: string;
  HOST_RT: string;
  HOST_ID: string;
}
const wrangler = JSON.parse(stripJsonc(readFileSync(path.join(repoRoot, 'services/edge/wrangler.jsonc'), 'utf8'))) as {
  vars: Vars;
  env: { staging: { vars: Vars } };
};
const hosts = (v: Vars): Record<string, string> => ({ media: v.HOST_MEDIA, ugc: v.HOST_UGC, rt: v.HOST_RT, id: v.HOST_ID });

describe('CSP hosts of the static _headers build', () => {
  it('mirror the HOST_* vars of services/edge/wrangler.jsonc', () => {
    expect(STAGING_CSP_HOSTS).toEqual(hosts(wrangler.env.staging.vars));
    expect(PROD_CSP_HOSTS).toEqual(hosts(wrangler.vars));
  });

  it('select the environment and add the R2 endpoint only with an account id', () => {
    expect(cspForBuild({})).toContain(STAGING_CSP_HOSTS.media);
    expect(cspForBuild({ DV_CSP_ENV: 'prod' })).toContain(PROD_CSP_HOSTS.media);
    expect(cspForBuild({})).not.toContain('r2.cloudflarestorage.com');
    expect(cspForBuild({ CLOUDFLARE_ACCOUNT_ID: 'abc123' })).toContain('https://abc123.r2.cloudflarestorage.com');
  });

  it('public/_headers carries the placeholder the build replaces, and none for /account/', () => {
    const text = readFileSync(path.join(repoRoot, 'apps/web/public/_headers'), 'utf8');
    expect(text.match(/%CSP_REPORT_ONLY%/g)).toHaveLength(1);
    const account = text.slice(text.indexOf('/account/*'));
    expect(account).toContain('! Content-Security-Policy-Report-Only');
    expect(account).not.toContain('%CSP_REPORT_ONLY%');
  });
});
