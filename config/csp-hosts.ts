/**
 * Origins that the app-document CSP names (spec/05-api-and-realtime.md section 1.3), for the build that writes
 * apps/web/dist/_headers. They mirror the HOST_* vars of services/edge/wrangler.jsonc (a unit test compares them), because
 * no custom domain exists yet (Q-15). `DV_CSP_ENV=prod` selects the production hosts; anything else the staging hosts.
 * `CLOUDFLARE_ACCOUNT_ID`, when set, adds the R2 S3 endpoint for presigned uploads.
 */
import { buildCspReportOnly, type CspHosts } from '../packages/shared/src/platform/csp.ts';

export const STAGING_CSP_HOSTS: CspHosts = {
  media: 'https://tha-bay-media-staging.workers.dev',
  ugc: 'https://tha-bay-ugc-staging.workers.dev',
  rt: 'https://tha-bay-rooms-staging.gratitude-8f4.workers.dev',
  id: 'https://tha-bay-web-staging.gratitude-8f4.workers.dev',
};

export const PROD_CSP_HOSTS: CspHosts = {
  media: 'https://tha-bay-media.workers.dev',
  ugc: 'https://tha-bay-ugc.workers.dev',
  rt: 'https://tha-bay-rooms.gratitude-8f4.workers.dev',
  id: 'https://tha-bay-web.gratitude-8f4.workers.dev',
};

export function cspForBuild(env: Record<string, string | undefined> = process.env): string {
  const base = env['DV_CSP_ENV'] === 'prod' ? PROD_CSP_HOSTS : STAGING_CSP_HOSTS;
  const accountId = env['CLOUDFLARE_ACCOUNT_ID'];
  return buildCspReportOnly(accountId ? { ...base, accountId } : base);
}
