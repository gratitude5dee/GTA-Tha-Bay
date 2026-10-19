# 04 — Data models, part 10: database schema (C12 storage)

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. SQL copied verbatim from `spec/domains/09-backend-db.md` §3 (S09; C12 1.1 storage corrections folded into 0003 and 0007 on 2026-10-18, DL-197; save tombstone retention DL-195). The owner spec stays normative. Database: Supabase Pro, region `us-west-1`, Postgres + RLS + pgvector (D-02) [research/stack-cloudflare-backend.md §2]; staging is a separate project. R2 key layout, KV keys and Durable Object storage: `09-backend-db.md` §4–§6.

## 1. Rules

1. Every user-owned row keys on `profile_id uuid` (the identity profile id: UUIDv7 minted on the device in P0, never a provider subject). Provider subjects appear only in `identities`.
2. Primary keys are UUIDv7 minted in the Worker, except append-only logs (`bigint generated always as identity`). Timestamps are `timestamptz` in the database and epoch ms in every DTO. No triggers or RPC functions on core game paths (saves, progress, profiles); they are allowed in moderation, forum and NPC memory.
3. Two access paths from Workers: the user path (supabase-js 2.118.0 [F-016] with the caller's ES256 JWT, our issuer registered as Supabase Third-Party Auth; RLS is the second line of defence) for `profiles`, `save_*`, `forum_*` writes and votes from P1; the service path (`sb_secret_…` key, bypasses RLS) for everything else and every P0 write.
4. RLS is enabled on every table; tables marked server-only have no policies (deny-all to `anon` and `authenticated`).
5. Policy helpers: `app.pid()` = `nullif(auth.jwt()->>'sub','')::uuid`; `app.tier()` = `auth.jwt()->>'tier'`.
6. Under-18 profiles are blocked from online features (D-30, DL-139); no table stores their data except the `age_assurance` bracket and block flag.
7. Each migration runs in one transaction; `create index concurrently` is banned by lint.

## 2. Migration files

Files `supabase/migrations/<NNNN>_<name>.sql`, applied by `pnpm db:push` (`supabase db push`) from `deploy.yml`.

| File | Tables | Owner text milestone | Register id |
|---|---|---|---|
| `0001_core.sql` | schema `app`, helpers, `profiles`, `device_keys`, `identities`, `refresh_tokens`, `staff_roles`, `idempotency_keys`, `audit_log`, `age_assurance` | M05d | M05d |
| `0002_genai.sql` | `cutscene_catalog`, `cutscenes`, `genai_ledger`, `budget_daily`, `telemetry_daily`; S05 pipeline tables `gen_run`, `gen_job`, `asset_index`, `bark_index`, `budget_program` | M05d | M05d |
| `0003_npc.sql` | `vector` extension, `npc_relationship`, `npc_memory`, `match_npc_memories()`, `encounter_transcripts`, `roster_flag`, `likeness_subject`, `consent_record`, `consent_event` | M06a | M06a1 |
| `0004_moderation.sql` | enums, `moderation_item`, `moderation_signal`, `moderation_case`, `moderation_decision`, `user_report`, `enforcement_action`, `uploads`, `npc_draft`, `npc_soul` | M06b | M06b1 |
| `0005_saves.sql` | `save_profiles`, `save_records`, `unlocks` | M12a | M12a1 |
| `0006_online.sql` | `progress_wallet`, `progress_commits`, `leaderboard_scores` | M12c | M12c family (route 21 validators M12e) |
| `0007_ugc_forum.sql` | `mods`, `mod_versions`, `experiences`, `forum_boards`, `forum_threads`, `forum_posts`, `forum_votes`, `device_codes` | M13a, M13b | M13a2 (mods, experiences), M13b1 (forum), M13c1 (device codes) |
| `0008_legal.sql` | `takedown_request`, `ncmec_report`, `evidence_object`, `hash_bank_entry` | M13d | M13d1 |
| `0009_link.sql` | `merge_requests`, `siwe_nonces` | M14a | M14a |

Commands (root):

```bash
pnpm check:db          # supabase db start → db lint --level error --fail-on error → supabase test db (pgTAP)
pnpm check:db:types    # supabase gen types typescript --local > packages/shared/src/db.gen.ts && git diff --exit-code
pnpm db:push           # apply migrations to the linked project (deploy.yml)
```

## 3. Schema

### 3.1 Identity and core (0001)

```sql
create schema if not exists app;
create function app.pid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function app.tier() returns text language sql stable as $$ select auth.jwt()->>'tier' $$;

create table profiles (
  id uuid primary key,                              -- = profile_id
  tier text not null default 'local' check (tier in ('local','device','linked')),
  display_name text check (char_length(display_name) between 1 and 24),   -- moderated (names:lint + classifier) before shown to others
  display_name_state text not null default 'none' check (display_name_state in ('none','pending','ok','rejected')),
  created_at timestamptz not null default now(),
  registered_at timestamptz,                        -- P1
  last_seen_at timestamptz not null default now(),
  flags jsonb not null default '{}',                -- {chatOptIn, publishBan, …}
  deleted_at timestamptz                            -- set by forget; row purged by cron within 24 h
);
alter table profiles enable row level security;
create policy profiles_self_read on profiles for select to authenticated using (id = app.pid());
create policy profiles_self_update on profiles for update to authenticated using (id = app.pid()) with check (id = app.pid());

create table device_keys (
  kid text primary key,                             -- RFC 7638 thumbprint
  profile_id uuid not null references profiles(id) on delete cascade,
  public_jwk jsonb not null, created_at timestamptz not null default now(),
  last_used_at timestamptz, revoked_at timestamptz
);
create index on device_keys (profile_id);
alter table device_keys enable row level security;   -- server-only

create table identities (
  provider text not null check (provider in ('openai','thirdweb','supabase-oauth')),
  subject text not null,                            -- OIDC sub or lowercase EOA address; never copied elsewhere
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(), last_used_at timestamptz,
  primary key (provider, subject)
);
create index on identities (profile_id);
alter table identities enable row level security;   -- server-only

create table refresh_tokens (
  token_hash bytea primary key,                     -- sha256(secret)
  family uuid not null, profile_id uuid not null references profiles(id) on delete cascade,
  aud text not null default 'tha-bay' check (aud in ('tha-bay','tha-bay-cli')),
  issued_at timestamptz not null default now(), expires_at timestamptz not null,   -- +30 d
  used_at timestamptz, revoked_at timestamptz
);
create index on refresh_tokens (family); create index on refresh_tokens (profile_id);
alter table refresh_tokens enable row level security; -- server-only

create table staff_roles (
  profile_id uuid not null references profiles(id) on delete cascade,
  scope text not null check (scope in ('mod:review','mod:trust_lead','admin','ops')),
  granted_by uuid not null, granted_at timestamptz not null default now(),
  primary key (profile_id, scope)
);
alter table staff_roles enable row level security;  -- server-only; changes write audit_log

create table idempotency_keys (
  key uuid primary key, profile_id uuid, route text not null,
  status smallint not null, response jsonb not null, created_at timestamptz not null default now()
);                                                  -- purged after 24 h
alter table idempotency_keys enable row level security; -- server-only

create table audit_log (                            -- append-only, hash-chained; INSERT-only grant to the service role
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  actor text not null, role text not null, action text not null,
  target_kind text, target_id text, details jsonb not null default '{}',
  prev_hash bytea, row_hash bytea not null          -- sha256(prev_hash || canonical_json(row without hashes))
);
alter table audit_log enable row level security;    -- server-only
revoke update, delete on audit_log from service_role;

create table age_assurance (
  profile_id uuid primary key references profiles(id) on delete cascade,
  declared_bracket text check (declared_bracket in ('u13','13_15','16_17','18p')),   -- birth date never stored
  declared_at timestamptz,
  signal_source text not null default 'none' check (signal_source in ('none','apple_dar','play_age_signals','browser_age_range','dc_api')),
  signal_bracket text, signal_at timestamptz,
  effective_bracket text not null, blocked boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table age_assurance enable row level security; -- server-only
```

Age rules: effective bracket = lowest of declared and signal; v1 requests no signal and ships only the `none` provider [research/gap-trust-safety-tooling.md §6.8, §7.5].

### 3.2 GenAI index, ledger, telemetry rollup (0002)

```sql
create table cutscene_catalog (                     -- keys our own mission/fight/race scripts may request (C09); loaded from the release cutscene-index (CutsceneRef → key) built by tools/assets in CI (S05/S03)
  cache_key text primary key, template_id text not null, template_ver int not null,
  characters text[] not null, source text not null, -- 'mission:<id>' | 'fight:<a>:<b>' | …
  priority smallint not null default 5, added_at timestamptz not null default now()
);
create table cutscenes (
  cache_key text primary key,
  status text not null check (status in ('pending','ready','failed','quarantined')),
  r2_prefix text not null,                          -- cutscenes/<key>/
  endpoint_id text not null, endpoint_updated_at text not null, provider_request_id text,
  cost_usd_micros bigint, workflow_instance text not null,
  char_ids text[] not null default '{}',            -- kill-switch purge index ('char:<id>' R2 tags)
  created_at timestamptz not null default now(), ready_at timestamptz, error text
);
create index on cutscenes using gin (char_ids);
create table genai_ledger (                         -- nightly export of BudgetGovernorDO; kept 3 years
  id bigint generated always as identity primary key, ts timestamptz not null,
  vendor text not null, model text not null, kind text not null,   -- dialogue|summary|builder|cutscene|tts|moderation|embedding|asset
  usd_micros bigint not null, settled boolean not null, request_id text, job_id text, env text not null
);
create index on genai_ledger (ts); create index on genai_ledger (vendor, ts);
create table budget_daily (day date not null, vendor text not null, ceiling_usd_micros bigint not null,
  spent_usd_micros bigint not null, max_level smallint not null, primary key (day, vendor));
create table telemetry_daily (                      -- aggregates only, no sessionId; 25 months
  day date not null, name text not null, build text not null, device_class text not null, tier text not null,
  os_major smallint not null, count bigint not null, metrics jsonb not null,   -- {p50:…, p95:…}
  primary key (day, name, build, device_class, tier, os_major)
);
alter table cutscene_catalog enable row level security; alter table cutscenes enable row level security;
alter table genai_ledger enable row level security; alter table budget_daily enable row level security;
alter table telemetry_daily enable row level security;   -- all server-only
```

### 3.2a S05 pipeline tables (0002; integration DDL, DL-198)

`09-backend-db.md` §2 and `05-assets-pipeline.md` §13 name these tables and their key columns but give no DDL. The DDL below uses exactly those columns plus the C07 `GenJob` fields that S05's `DbPort` reads and writes; M05d may add columns, never rename these. All server-only.

```sql
create table gen_run (id uuid primary key, requested_by text not null, env text not null check (env in ('production','previs','test')),
  budget_usd_micros bigint not null, created_at timestamptz not null default now(), closed_at timestamptz);
create table gen_job (id uuid primary key, job_key text unique not null,                -- C07 jobKey (sha256 hex)
  run_id uuid references gen_run(id), kind text not null, endpoint_key text not null,  -- C07 GenKind, registry key
  env text not null check (env in ('production','previs','test')), asset_ref text not null,   -- GenJob.subject.assetRef
  state text not null, request_id text, budget_usd_micros bigint not null, cost_usd_micros bigint,
  created_at timestamptz not null default now(), settled_at timestamptz);
create table asset_index (ref text not null, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('active','quarantined','killed')), tags text[] not null default '{}',   -- 'char:<npcId>' purge index
  primary key (ref, sha256));
create index on asset_index using gin (tags);
create table bark_index (voice_id text not null, key text not null, primary key (voice_id, key));   -- audio/barks/<sha256>.opus
create table budget_program (vendor text primary key, cap_usd_micros bigint not null check (cap_usd_micros >= 0),
  alarms real[] not null default '{0.5,0.8,1.0}');   -- mirror of config/guardrails.yaml genai.*; fal row = 100000000 (DL-OWN-01)
alter table gen_run enable row level security; alter table gen_job enable row level security;
alter table asset_index enable row level security; alter table bark_index enable row level security;
alter table budget_program enable row level security;   -- all server-only
```

### 3.3 NPC memory, likeness, kill-switch (0003)

```sql
create extension if not exists vector;
create table npc_relationship (
  profile_id uuid not null references profiles(id) on delete cascade, npc_id text not null,
  affinity smallint not null default 0 check (affinity between -100 and 100),
  trust smallint not null default 0 check (trust between -100 and 100),
  flags jsonb not null default '{}', encounters int not null default 0,
  summary text not null default '' check (char_length(summary) <= 1200),
  soul_version int not null, last_seen_at timestamptz not null default now(),
  primary key (profile_id, npc_id)
);
create table npc_memory (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles(id) on delete cascade, npc_id text not null,   -- '*' = world scope
  scope text not null check (scope in ('pair','npc','world')),
  kind text not null check (kind in ('player_fact','promise','event','preference','rumor','reflection')),
  text text not null check (char_length(text) <= 240),          -- model-paraphrased, PII-scrubbed; never raw player text
  importance smallint not null check (importance between 1 and 10),
  game_time bigint not null /* C06 WorldClockState.t, integer game half-seconds */, source text not null check (source in ('dialogue','mission','world','summary')),
  embedding halfvec(1024) not null,                              -- bge-m3 (D-22)
  created_at timestamptz not null default now(), last_accessed_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days'   -- reset to +180 d on access
);
create index npc_memory_pair on npc_memory (profile_id, npc_id, created_at desc);   -- exact scan per pair, no ANN index
-- match_npc_memories(p_profile, p_npc, q halfvec(1024), now_gt, k default 6): as research/ai-npc-runtime.md §4.2 (0.5 relevance + 0.3 importance + 0.2 recency);
-- recency scale 518400 game half-seconds (72 game hours on the C06 clock), not 72*3600 (C12 1.1 §3, DL-058)
create table encounter_transcripts (                -- index of R2 objects written by EncounterDO on close
  encounter_id text primary key, profile_id uuid not null references profiles(id) on delete cascade,
  npc_id text not null, r2_key text not null, turns smallint not null, usd_micros bigint not null,
  closed_at timestamptz not null, expires_at timestamptz not null   -- closed_at + 30 d (D-22)
);
create table roster_flag (
  npc_id text primary key, killed boolean not null default false,
  scope text[] not null default '{all}' check (scope <@ array['all','spawn','fighter','cutscene','voice','marketing','ugc']),
  reason text check (reason in ('consent_revoked','complaint','legal','safety','quality')),
  stand_in text not null, ticket_id text, set_by uuid not null, set_at timestamptz not null default now()
);
create table likeness_subject (
  id text primary key, real_name text not null, aliases text[] not null default '{}', marks text[] not null default '{}',
  deceased boolean not null default false, died_on date, estate_contact text, sos_registration_ref text,
  default_tier text not null check (default_tier in ('consented','parody','fictionalized')),
  notes text, created_at timestamptz not null default now()
);
create table consent_record (                       -- columns exactly as research/legal-ip-likeness.md L2
  id text primary key, subject_id text not null references likeness_subject(id),
  signatory_name text not null, signatory_capacity text not null check (signatory_capacity in ('self','estate','agent','guardian')),
  scopes text[] not null, media text[] not null, use_description text not null, territory text not null default 'worldwide',
  term_start date not null, term_end date, revocable boolean not null default true, revocation_terms text not null,
  compensation_ref text, counsel_represented boolean not null, union_covered boolean not null default false,
  evidence_r2_key text not null, evidence_sha256 text not null, approved_by uuid not null, approved_at timestamptz not null,
  revoked_at timestamptz, revoked_reason text
);
create table consent_event (id bigint generated always as identity primary key, consent_id text references consent_record(id),
  kind text check (kind in ('granted','amended','renewal_due','revoked','expired','audit')),
  actor text, at timestamptz not null default now(), details jsonb);
alter table npc_relationship enable row level security; alter table npc_memory enable row level security;
create policy rel_self_read on npc_relationship for select to authenticated using (profile_id = app.pid());
create policy mem_self_read on npc_memory for select to authenticated using (profile_id = app.pid());   -- writes service-only
alter table encounter_transcripts enable row level security; alter table roster_flag enable row level security;
alter table likeness_subject enable row level security; alter table consent_record enable row level security;
alter table consent_event enable row level security;   -- server-only
```

### 3.4 Moderation, uploads, NPC builder (0004; 0008 legal)

`moderation_item`, `moderation_signal`, `moderation_case`, `moderation_decision`, `user_report`, `enforcement_action` follow [research/gap-trust-safety-tooling.md §6.8] exactly (enums `mod_subject`, `mod_state`; queues `P0_CSAM | P0_NCII | P1_SAFETY | P1_LEGAL | P2_REVIEW | P3_REVIEW | APPEAL`; `sla_due_at` at insert) with two changes: every id is a Worker-minted `uuid`, and `moderation_case.subject_snapshot jsonb` is added. The `mod_subject` enum carries the C12 1.1 `ModSubject` values (including `npc_soul`). `npc_draft` and `npc_soul` follow [research/ai-npc-runtime.md §6.2] (S04 semantics, `04-npc-builder.md` §C2). All server-only.

```sql
create table uploads (                              -- one row per presigned PUT (C12 route 34)
  id uuid primary key, profile_id uuid not null references profiles(id) on delete cascade,
  purpose text not null, bucket text not null default 'ugc-staging', r2_key text not null,
  content_type text not null, declared_bytes int not null, actual_bytes int,
  state text not null default 'issued' check (state in ('issued','committed','scanning','allowed','rejected','quarantined','expired')),
  moderation_item_id uuid, created_at timestamptz not null default now(), committed_at timestamptz
);
create index on uploads (profile_id, created_at desc);
```

`0008_legal.sql`: `takedown_request` (id, kind `dmca|ncii|publicity|trademark|csam|other`, received_at, requester jsonb, target_refs jsonb, status, sla_due_at, statutory_due_at, decision, counter_notice_at, restored_at, copies_found, copy_sweep_job, requester_notified_at), `ncmec_report`, `evidence_object`, `hash_bank_entry` per [research/gap-trust-safety-tooling.md §6.8] and [research/legal-ip-likeness.md Recommendations 10]; NCII clock `received_at + 48 h` (F-066). All server-only.

### 3.5 Saves and unlocks (0005)

```sql
create table save_profiles (                        -- Grand-V save-profile rules [research/repos-grand-v.md (d)]
  id text not null check (id ~ '^[0-9a-f]{32}$'),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null, updated_at timestamptz not null default now(), deleted_at timestamptz,   -- written by C12 routes 50/51
  primary key (profile_id, id), unique (profile_id, name)
);
create table save_records (
  profile_id uuid not null, save_profile_id text not null,
  slot text not null check (slot ~ '^(core|settings|sandbox|story:(auto|1|2|3)|mode:(racing|fighter|tycoon)|mod:[a-z0-9][a-z0-9._-]{0,63})$'),   -- C05 SlotId
  kind text not null,                               -- C05 SliceKind
  version bigint not null,                          -- server-assigned, +1 per accepted write
  client_updated_at timestamptz not null, server_updated_at timestamptz not null default now(),
  sha256 text not null, bytes int not null check (bytes <= 2097152),   -- C05 recordMaxBytes
  data jsonb,                                       -- inline when bytes ≤ 262144
  blob_key text,                                    -- saves/<profile>/<saveProfile>/<slot>/<version>.bin in R2
  save_version int not null,                        -- C05 SaveRecord.schema, for the server-side NEWER_SCHEMA refusal
  deleted_at timestamptz,                           -- tombstone, kept 180 d (C05 SAVE_LIMITS.tombstoneRetentionDays, DL-195)
  primary key (profile_id, save_profile_id, slot),
  foreign key (profile_id, save_profile_id) references save_profiles(profile_id, id) on delete cascade,
  check ((data is null) <> (blob_key is null) or deleted_at is not null)
);
create index on save_records (profile_id, server_updated_at);
create table unlocks (                              -- union of unlock events across devices (R-MODE-05); the save stays authoritative for SP
  profile_id uuid not null references profiles(id) on delete cascade,
  unlock_id text not null check (unlock_id ~ '^unlock\.[a-z0-9._-]{1,96}$'),   -- C06 UnlockEventId (unlock.racing, unlock.fighter.<id>, unlock.district.<id>), C05 CoreSlice.unlocks
  unlocked_at timestamptz not null, source text not null, primary key (profile_id, unlock_id)
);
alter table save_profiles enable row level security; alter table save_records enable row level security; alter table unlocks enable row level security;
create policy sp_self on save_profiles for all to authenticated using (profile_id = app.pid()) with check (profile_id = app.pid());
create policy sr_self on save_records for all to authenticated using (profile_id = app.pid()) with check (profile_id = app.pid());
create policy ul_self_read on unlocks for select to authenticated using (profile_id = app.pid());
```

Worker caps: ≤ 64 save profiles per identity, ≤ 64 MiB total per identity profile, one write per slot per 5 s.

### 3.6 Online progression and leaderboards (0006)

```sql
create table progress_wallet (profile_id uuid primary key references profiles(id) on delete cascade,
  cash bigint not null default 0 check (cash >= 0), rep int not null default 0, updated_at timestamptz not null default now());
create table progress_commits (idempotency_key uuid primary key, profile_id uuid not null references profiles(id) on delete cascade,
  room_id text not null, kind text not null, delta jsonb not null, applied_at timestamptz not null default now());
create table leaderboard_scores (
  board text not null, profile_id uuid not null references profiles(id) on delete cascade,
  value bigint not null, replay_r2_key text, replay_sha256 text,
  verified boolean not null default false, verifier text, submitted_at timestamptz not null default now(),
  primary key (board, profile_id)
);
create index on leaderboard_scores (board, value) where verified;
-- all server-only; top-100 cached in KV `lb:<board>` for 30 s
```

### 3.7 Mods, experiences, forum, device codes (0007)

```sql
create table mods (id uuid primary key, owner_profile_id uuid not null references profiles(id), slug text unique not null,
  kind text not null check (kind in ('experience','vehicle','character','rules')), name text not null,
  visibility text not null default 'private' check (visibility in ('private','unlisted','public')),
  remix_allowed boolean not null default false, created_at timestamptz not null default now(), removed_at timestamptz);   -- slug = C14 ModId; DTOs never expose id
create table mod_versions (mod_id uuid not null references mods(id), version text not null,   -- semver
  manifest jsonb not null, archive_sha256 text not null, archive_key text not null,          -- ugc/published/<sha256>.zip
  moderation_item_id uuid not null, created_at timestamptz not null default now(),
  state text not null check (state in ('scanning','rejected','needs_review','published','unlisted_pending_review','yanked','removed')),   -- C14 ModVersionState (C12 1.1 §3)
  primary key (mod_id, version));
create table experiences (id uuid primary key, mod_id uuid not null references mods(id), mod_version text not null,
  chunk_key text not null, lat double precision not null, lng double precision not null, radius_m real not null check (radius_m <= 250),
  descriptor jsonb not null, rating_sum int not null default 0, rating_count int not null default 0,
  moderation_state text not null default 'needs_review' check (moderation_state in ('needs_review','published','rejected','needs_update','unlisted_pending_review','removed')),   -- C17 ExperienceModeration
  visibility text not null default 'private' check (visibility in ('private','unlisted','public')),   -- C17 ExperienceVisibility
  world_version text check (world_version ~ '^[0-9a-f]{64}$'),   -- C17 worldVersion = C08 bakeId (C12 1.1 §3)
  mod_sha256 text check (mod_sha256 ~ '^[0-9a-f]{64}$'),         -- C17 modSha256
  created_at timestamptz not null default now());
create index on experiences (chunk_key) where visibility = 'public' and moderation_state = 'published';

create table forum_boards (id text primary key, title text not null, sort smallint not null,
  min_tier text not null default 'device' check (min_tier in ('local','device','linked','staff')));   -- 'staff' per C12 1.1 §3
create table forum_threads (id uuid primary key, board_id text not null references forum_boards(id),
  author_profile_id uuid not null references profiles(id), title text not null check (char_length(title) between 3 and 120),
  experience_id uuid references experiences(id), mod_id uuid references mods(id),   -- mod_id: C12 1.1 §3 (mod discussion threads)
  state text not null default 'pending' check (state in ('pending','visible','held','removed','locked')),   -- pending until forum_text allow (DL-471)
  score int not null default 0, post_count int not null default 0, last_post_at timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('english', title)) stored, created_at timestamptz not null default now());
create index on forum_threads (board_id, last_post_at desc); create index on forum_threads using gin (tsv);
create table forum_posts (id uuid primary key, thread_id uuid not null references forum_threads(id),
  author_profile_id uuid not null references profiles(id), body text not null check (char_length(body) between 1 and 10000),
  state text not null default 'pending' check (state in ('pending','visible','held','removed')), score int not null default 0,
  attachment_upload_ids uuid[] not null default '{}', edited_at timestamptz, created_at timestamptz not null default now());
create index on forum_posts (thread_id, created_at);
create table forum_votes (profile_id uuid not null references profiles(id) on delete cascade, target_kind text not null check (target_kind in ('thread','post','experience')),
  target_id uuid not null, value smallint not null check (value in (-1,1)), created_at timestamptz not null default now(),
  primary key (profile_id, target_kind, target_id));
create table device_codes (device_code_hash bytea primary key, user_code text unique not null, scope text not null default 'mods:publish',
  profile_id uuid, approved_at timestamptz, expires_at timestamptz not null, last_poll_at timestamptz);
alter table mods enable row level security; alter table mod_versions enable row level security; alter table experiences enable row level security;
alter table forum_boards enable row level security; alter table forum_threads enable row level security;
alter table forum_posts enable row level security; alter table forum_votes enable row level security; alter table device_codes enable row level security;
create policy ft_public_read on forum_threads for select to authenticated, anon using (state in ('visible','locked'));
create policy fp_public_read on forum_posts for select to authenticated, anon using (state = 'visible');
create policy ft_author_insert on forum_threads for insert to authenticated with check (author_profile_id = app.pid() and app.tier() in ('device','linked'));
create policy fp_author_insert on forum_posts for insert to authenticated with check (author_profile_id = app.pid() and app.tier() in ('device','linked'));
create policy fv_self on forum_votes for all to authenticated using (profile_id = app.pid()) with check (profile_id = app.pid());
-- mods/mod_versions/experiences/device_codes: server-only; public listings are served by the Worker from published rows
```

Forum counters (`score`, `post_count`) are maintained by a trigger in 0007; no Supabase Realtime (clients poll every 15 s while a thread is open).

### 3.8 Link and merge (0009)

```sql
create table merge_requests (id uuid primary key, from_profile uuid not null references profiles(id), to_profile uuid not null references profiles(id),
  provider text not null, status text not null default 'open' check (status in ('open','accepted','rejected','expired')),
  conflicts jsonb not null default '{}', created_at timestamptz not null default now(), decided_at timestamptz);
create table siwe_nonces (nonce text primary key, profile_id uuid not null, expires_at timestamptz not null);   -- consumed by DELETE … RETURNING
alter table merge_requests enable row level security; alter table siwe_nonces enable row level security;   -- server-only
```

Merge rule: the player chooses the surviving profile; save profiles from both are kept (renamed on collision), `unlocks` are unioned, `npc_relationship` keeps the higher `encounters`, `progress_wallet` sums; the losing profile is tombstoned.

## 4. Indexes and RLS policies (summary of the SQL above)

| Table | Indexes beyond the primary key | Policies (role `authenticated` unless noted) |
|---|---|---|
| `profiles` | — | `profiles_self_read` select, `profiles_self_update` update where `id = app.pid()` |
| `device_keys`, `identities`, `refresh_tokens` | `profile_id`; `refresh_tokens (family)` | server-only |
| `staff_roles`, `idempotency_keys`, `audit_log`, `age_assurance` | — | server-only; `audit_log` update/delete revoked from `service_role` |
| `cutscene_catalog`, `cutscenes`, `genai_ledger`, `budget_daily`, `telemetry_daily` | `cutscenes` gin `char_ids`; `genai_ledger (ts)`, `(vendor, ts)` | server-only |
| `gen_run`, `gen_job`, `asset_index`, `bark_index`, `budget_program` | `gen_job.job_key` unique; `asset_index` gin `tags` | server-only |
| `npc_relationship`, `npc_memory` | `npc_memory_pair (profile_id, npc_id, created_at desc)`; no ANN index | `rel_self_read`, `mem_self_read` select own rows; writes service-only |
| `encounter_transcripts`, `roster_flag`, `likeness_subject`, `consent_record`, `consent_event` | — | server-only |
| moderation tables, `uploads`, `npc_draft`, `npc_soul` | `uploads (profile_id, created_at desc)` | server-only |
| `save_profiles`, `save_records` | `save_records (profile_id, server_updated_at)` | `sp_self`, `sr_self` all operations on own rows |
| `unlocks` | — | `ul_self_read` select own rows |
| `progress_wallet`, `progress_commits`, `leaderboard_scores` | `leaderboard_scores (board, value) where verified` | server-only |
| `mods`, `mod_versions`, `experiences`, `device_codes` | `experiences (chunk_key)` where public and published | server-only |
| `forum_boards` | — | none (served by the Worker) |
| `forum_threads`, `forum_posts` | `(board_id, last_post_at desc)`, gin `tsv`; `(thread_id, created_at)` | public read (`anon` too) of visible rows; insert by author with tier `device` or `linked` |
| `forum_votes` | — | `fv_self` all operations on own rows |
| `merge_requests`, `siwe_nonces`, 0008 legal tables | — | server-only |

Required pgTAP files (`supabase/tests/`): `rls_profiles.sql`, `rls_saves.sql`, `rls_forum.sql`, `server_only.sql` (every table without policies returns 0 rows to `authenticated` and `anon`), `audit_append_only.sql`, `memory_match.sql`.

## 5. Retention and deletion

| Data | Retention | Mechanism (Cron Trigger on `tha-bay-web`, UTC) |
|---|---|---|
| Encounter transcripts | 30 d | R2 lifecycle rule on `transcripts/` + `encounter_transcripts` purge (03:10 daily) |
| `npc_memory` | 180 d after last access | `delete where expires_at < now()` (03:20) |
| `npc_relationship` | until profile deletion or 180 d inactive | `last_seen_at < now() − 180 d` (03:20) |
| P0 stub profiles (`tier='local'`) | 180 d after `last_seen_at` | cascade delete (03:30) |
| `DELETE /me` | profile row and cascades within 24 h; R2 saves/exports/transcripts by prefix | queue job `forget` + daily sweep |
| Moderation signals of allowed items | 90 d | 03:40 |
| Decisions, audit, enforcement | 2 y | 03:40 |
| UGC staging media | 7 d after terminal state | R2 lifecycle |
| Evidence | ≥ 1 y (bucket lock 400 d), legal hold indefinite | R2 bucket lock |
| `refresh_tokens`, `device_codes`, `siwe_nonces`, `idempotency_keys` | at expiry (+24 h for idempotency) | hourly |
| `telemetry_daily` | 25 months | monthly |
| `genai_ledger` | 3 y | yearly |
| Save tombstones (`save_records.deleted_at`, `save_profiles.deleted_at`) | 180 d (C05 `SAVE_LIMITS.tombstoneRetentionDays`; DL-195) | 03:30 with the stub-profile sweep |

`GET /me/export` builds a ZIP of every row and R2 object keyed by the profile within 24 h and returns a 7-day presigned link; `DELETE /me` cascades within 24 h (D-22; [research/legal-ip-likeness.md §8 P6]; [research/gap-trust-safety-tooling.md §6.6]).
