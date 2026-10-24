// The Supabase implementation of the DataPort (M05d): the only real one, on the service path with SUPABASE_SECRET_KEY.
// Members whose tables land later reject with NotImplementedError('<milestone>'), exactly as InMemoryDataPort does.
// No row content, key or filter value is ever logged; a failed call surfaces as DataPortError (code and table only).
import {
  later,
  rejectLater,
  type DeviceCodeStore,
  type ForumStore,
  type ModerationStore,
  type ServerDataPort,
  type UgcStore,
} from '@dv/shared/data-port';
import { createServiceClient, type SupabaseConfig } from './client.ts';
import { catalog, cutscenes } from './cutscenes.ts';
import { ledger } from './ledger.ts';
import { maintenance } from './maintenance.ts';
import { npcMemory } from './npc-memory.ts';
import { profiles } from './profiles.ts';
import { audit, roster } from './roster.ts';

export { DataPortError, createServiceClient, type Db, type SupabaseConfig } from './client.ts';

export function supabaseDataPort(cfg: SupabaseConfig): ServerDataPort {
  const db = createServiceClient(cfg);
  const defaultEnv = cfg.env;
  const maint = maintenance(db);
  return {
    profiles: profiles(db, maint),
    identity: {
      putRefresh: rejectLater('M12a1'),
      rotateRefresh: rejectLater('M12a1'),
      link: rejectLater('M12a1'),
      deviceCode: later<DeviceCodeStore>('M13c1'),
    },
    saves: {
      sync: rejectLater('M12a1'),
      putProfile: rejectLater('M12a1'),
      deleteProfile: rejectLater('M12a1'),
      put: rejectLater('M12a1'),
      tombstone: rejectLater('M12a1'),
    },
    progress: { commit: rejectLater('M12c') },
    leaderboards: { top: rejectLater('M12c'), submit: rejectLater('M12c') },
    npcMemory: npcMemory(db),
    cutscenes: cutscenes(db),
    catalog: catalog(db),
    ugc: later<UgcStore>('M13a2'),
    forum: later<ForumStore>('M13b1'),
    moderation: later<ModerationStore>('M06b1'),
    ledger: ledger(db, defaultEnv),
    roster: roster(db),
    audit: audit(db),
    maintenance: maint,
  };
}
