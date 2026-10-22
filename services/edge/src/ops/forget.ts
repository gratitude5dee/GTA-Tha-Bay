import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';

/**
 * The forget job (`DELETE /me`, route 14; spec/domains/09-backend-db.md section 7): within 24 h of the request no row keyed by the profile and no
 * R2 object under its prefixes remains. The route marks the profile deleted at once (`profiles.forget`) and queues this job; a daily sweep
 * (03:30) runs it again for any soft-deleted profile that is still there. Every step is idempotent, so a retry after a crash is safe.
 *
 * Credential handlers: per-provider accounts (the Supabase password account, linked providers) are not linked to a profile before M12a1, so the
 * list is empty here. M12a1 pushes its handler onto `FORGET_HANDLERS` without editing this file.
 */
export interface CredentialHandler {
  name: string;
  /** Deletes what the provider holds for the profile. Runs before the profile row is purged. */
  forget(env: Env, profileId: string): Promise<void>;
  /** The provider's part of the data export (JSON-safe). */
  export?(env: Env, profileId: string): Promise<Record<string, unknown>>;
}

export const CREDENTIAL_HANDLERS: CredentialHandler[] = [];

/** R2 prefixes of PRIVATE that hold a profile's objects other than transcripts (those are found through `encounter_transcripts`). */
export const profilePrefixes = (profileId: string): string[] => [`exports/${profileId}/`, `saves/${profileId}/`];

/** Deletes every object under a prefix; returns how many. */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let n = 0;
  for (;;) {
    const page = await bucket.list({ prefix, limit: 1000 });
    if (page.objects.length === 0) return n;
    await bucket.delete(page.objects.map((o) => o.key));
    n += page.objects.length;
    if (!page.truncated) return n;
  }
}

export interface ForgetResult {
  profileId: string;
  r2Deleted: number;
  purged: boolean;
}

export async function runForget(env: Env, deps: Pick<AppDeps, 'data' | 'log'>, profileId: string, handlers: readonly CredentialHandler[] = CREDENTIAL_HANDLERS): Promise<ForgetResult | null> {
  const port = deps.data(env);
  if (port === null) return null;
  let r2Deleted = 0;
  const keys = await port.maintenance.transcriptKeys(profileId);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await env.PRIVATE.delete(batch);
    r2Deleted += batch.length;
  }
  for (const prefix of profilePrefixes(profileId)) r2Deleted += await deletePrefix(env.PRIVATE, prefix);
  for (const h of handlers) await h.forget(env, profileId);
  const purged = await port.maintenance.purgeProfile(profileId);
  deps.log(JSON.stringify({ event: 'forget.done', r2Deleted, purged }));
  return { profileId, r2Deleted, purged };
}
