/**
 * Shared fixtures of the secret-env specs (BD-FIX-SEC-01, BD-FIX-SEC-02): the fast unit spec tools/ci/test/secret-env.test.ts
 * (`check:unit`) and the nested-runner probes services/edge/test/node/secret-env-runners.test.ts (`check:workers`).
 */
import { ALLOW_LIVE_SECRETS_ENV } from '../secret-env.ts';

/** An obviously fake value; never a real secret. */
export const FAKE = 'test-not-a-secret';

/** Every name the incident, CLAUDE.md "Secrets", deploy.ts and the workflows name (plus a few of each prefix). */
export const FAKE_NAMES = [
  'FAL_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_PASSWORD_STAGING',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_PROJECT_ID_PRODUCTION',
  'SUPABASE_PROJECT_ID_STAGING',
  'SUPABASE_URL',
  'PLAY_TOKEN_HMAC',
  'PLAY_TOKEN_HMAC_PREV',
  'QUOTA_NET_SALT_SECRET',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BUILDER_KEY',
  'ANTHROPIC_EVALS_KEY',
  'OPENAI_MODERATION_API_KEY',
  'INTERNAL_HMAC',
  'ID_SIGNING_JWK_CURRENT',
  'ID_SIGNING_JWK_NEXT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PRIVATE_ACCESS_KEY_ID',
  'R2_PRIVATE_SECRET_ACCESS_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'DV_NAMES_REAL_JSON',
  'OPS_TOKEN',
  'ELEVENLABS_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;

export const fakeEnv = (): Record<string, string> => Object.fromEntries(FAKE_NAMES.map((k) => [k, FAKE]));

/** The parent's environment without the opt-in, so a developer's own DV_ALLOW_LIVE_SECRETS never changes what these specs prove. */
export const baseEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env[ALLOW_LIVE_SECRETS_ENV];
  return env;
};
