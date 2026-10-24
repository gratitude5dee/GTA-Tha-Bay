import { rejectLater, type DataPort, type MaintenanceStore, type ProfileRow } from '@dv/shared/data-port';
import { bytesStream, zipOfRows } from '@dv/shared/zip';
import { fromIso, fromIsoOrNull, isUniqueViolation, must, mustMaybe, toIso, type Db } from './client.ts';

/** Maps a `profiles` row from the database to the port's row (timestamps in epoch ms). */
export function profileRow(r: {
  id: string;
  tier: string;
  display_name: string | null;
  display_name_state: string;
  created_at: string;
  registered_at: string | null;
  last_seen_at: string;
  flags: unknown;
  deleted_at: string | null;
}): ProfileRow {
  return {
    id: r.id,
    tier: r.tier,
    display_name: r.display_name,
    display_name_state: r.display_name_state,
    created_at: fromIso(r.created_at),
    registered_at: fromIsoOrNull(r.registered_at),
    last_seen_at: fromIso(r.last_seen_at),
    flags: r.flags as ProfileRow['flags'],
    deleted_at: fromIsoOrNull(r.deleted_at),
  };
}

/**
 * Binds a device key thumbprint to a profile. 'taken' when the thumbprint already belongs to another profile.
 * The public JWK is not part of the DataPort signature (C12 section 2.6), so the column holds `{}` until a later route supplies it (BD-M05d-04).
 */
async function bindKey(db: Db, pid: string, dkt: string): Promise<'bound' | 'taken'> {
  const res = await db.from('device_keys').insert({ kid: dkt, profile_id: pid, public_jwk: {} });
  if (!res.error) return 'bound';
  if (!isUniqueViolation(res.error)) must('device_keys', res);
  const owner = mustMaybe('device_keys', await db.from('device_keys').select('profile_id').eq('kid', dkt).maybeSingle());
  return owner !== null && owner.profile_id === pid ? 'bound' : 'taken';
}

export function profiles(db: Db, maintenance: MaintenanceStore, now: () => number = Date.now): DataPort['profiles'] {
  return {
    async ensureLocal(pid, dkt) {
      const inserted = must('profiles', await db.from('profiles').upsert({ id: pid }, { onConflict: 'id', ignoreDuplicates: true }).select('id'));
      if (inserted.length === 1) {
        if ((await bindKey(db, pid, dkt)) === 'bound') return 'created';
        // The thumbprint belongs to another profile: take back the profile this call just made.
        must('profiles', await db.from('profiles').delete().eq('id', pid));
        return 'key_mismatch';
      }
      const keys = must('device_keys', await db.from('device_keys').select('kid').eq('profile_id', pid).is('revoked_at', null));
      if (keys.some((k) => k.kid === dkt)) {
        must('device_keys', await db.from('device_keys').update({ last_used_at: toIso(Date.now()) }).eq('kid', dkt));
        return 'exists';
      }
      // A profile that has no key yet binds the first key it is seen with; one that has keys refuses another.
      if (keys.length === 0 && (await bindKey(db, pid, dkt)) === 'bound') return 'exists';
      return 'key_mismatch';
    },
    upgrade: rejectLater('M12a1'),
    async get(ctx) {
      if (ctx.profileId === null) return null;
      const row = mustMaybe('profiles', await db.from('profiles').select('*').eq('id', ctx.profileId).is('deleted_at', null).maybeSingle());
      return row === null ? null : profileRow(row);
    },
    async exportAll(ctx) {
      return bytesStream(zipOfRows(await maintenance.exportRows(ctx.profileId ?? '')));
    },
    /** The soft step of DELETE /me: the profile stops existing for the API at once; the forget job purges the rows (maintenance.purgeProfile). */
    async forget(ctx) {
      if (ctx.profileId === null) return;
      must('profiles', await db.from('profiles').update({ deleted_at: toIso(now()) }).eq('id', ctx.profileId).is('deleted_at', null).select('id'));
    },
  };
}
