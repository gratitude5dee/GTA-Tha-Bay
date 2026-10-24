-- 0003_npc (M06a1): NPC memory, relationships, transcripts index, roster kill-switch, likeness and consent tables.
-- Verbatim from spec/domains/09-backend-db.md section 3.3, plus match_npc_memories() from research/ai-npc-runtime.md section 4.2 with the
-- C12 1.1 recency scale (518,400 C06 half-seconds = 72 game hours; 09-backend-contracts-1.1.md section 3, DL-058).
-- Additions beyond the spec text are marked "M06a1:". RLS is on for every table; only npc_relationship and npc_memory have a policy
-- (self read, writes are service-only); the rest are server-only.

-- M06a1: Supabase installs extensions into schema "extensions"; plain Postgres (check:db --pg-url) has it from the shim.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

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
  embedding extensions.halfvec(1024) not null,                   -- bge-m3 (D-22)
  created_at timestamptz not null default now(), last_accessed_at timestamptz,
  expires_at timestamptz not null default now() + interval '180 days'   -- reset to +180 d on access
);
create index npc_memory_pair on npc_memory (profile_id, npc_id, created_at desc);   -- exact scan per pair, no ANN index
-- M06a1: the retention job (03:20) deletes by expires_at.
create index npc_memory_expires on npc_memory (expires_at);

-- 0.5 relevance + 0.3 importance + 0.2 recency. Exact scan over one pair plus the world scope ('*'); an expired row never matches.
-- Recency decays over 518,400 game half-seconds (72 game hours on the C06 clock), not 72*3600.
create or replace function match_npc_memories(p_profile uuid, p_npc text, q extensions.halfvec(1024), now_gt bigint, k int default 6)
returns table (id bigint, text text, kind text, score double precision)
language sql stable set search_path = public, extensions as $$
  select m.id, m.text, m.kind,
         (0.5 * (1 - (m.embedding <=> q))                                   -- relevance (cosine similarity)
        + 0.3 * (m.importance / 10.0)                                       -- importance
        + 0.2 * exp(-greatest(now_gt - m.game_time, 0) / 518400.0))::double precision as score   -- recency
  from npc_memory m
  where m.profile_id = p_profile and m.npc_id in (p_npc, '*')
    and m.expires_at > now()
  order by score desc, m.id
  limit k;
$$;
-- M06a1: service path only.
revoke execute on function match_npc_memories(uuid, text, extensions.halfvec, bigint, int) from public, anon, authenticated;
grant execute on function match_npc_memories(uuid, text, extensions.halfvec, bigint, int) to service_role;

create table encounter_transcripts (                -- index of R2 objects written by EncounterDO on close
  encounter_id text primary key, profile_id uuid not null references profiles(id) on delete cascade,
  npc_id text not null, r2_key text not null, turns smallint not null, usd_micros bigint not null,
  closed_at timestamptz not null, expires_at timestamptz not null   -- closed_at + 30 d (D-22)
);
-- M06a1: the retention job (03:10) deletes by expires_at; the forget job finds a profile's objects by profile_id.
create index encounter_transcripts_expires on encounter_transcripts (expires_at);
create index encounter_transcripts_profile on encounter_transcripts (profile_id);
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

-- M06a1: hash-chained append to audit_log. row_hash = sha256(prev_hash || canonical row), where the canonical row is the jsonb text of
-- {actor, role, action, target_kind, target_id, details, at} (jsonb orders its keys deterministically). An advisory transaction lock
-- serialises writers so the chain never forks. Service path only; audit_log keeps its INSERT-only grant (0001).
create or replace function audit_append(p_actor text, p_role text, p_action text, p_target_kind text, p_target_id text, p_details jsonb)
returns bigint language plpgsql set search_path = public, extensions as $$
declare
  v_prev bytea;
  v_at timestamptz := clock_timestamp();
  v_row jsonb;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('audit_log'));
  select row_hash into v_prev from audit_log order by id desc limit 1;
  v_row := jsonb_build_object('actor', p_actor, 'role', p_role, 'action', p_action, 'target_kind', p_target_kind, 'target_id', p_target_id,
                              'details', coalesce(p_details, '{}'::jsonb), 'at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  insert into audit_log (at, actor, role, action, target_kind, target_id, details, prev_hash, row_hash)
    values (v_at, p_actor, p_role, p_action, p_target_kind, p_target_id, coalesce(p_details, '{}'::jsonb), v_prev,
            sha256(coalesce(v_prev, ''::bytea) || convert_to(v_row::text, 'UTF8')))
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function audit_append(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function audit_append(text, text, text, text, text, jsonb) to service_role;
