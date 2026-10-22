-- 0001_core (M05d): identity and core tables, verbatim from spec/domains/09-backend-db.md section 3.1.
-- Additions beyond the spec text are marked "M05d:" (usage grant on schema app, truncate revoke on audit_log).
-- RLS is on for every table. Tables with no policy are server-only: deny-all to anon and authenticated.

create schema if not exists app;
-- M05d: policies call app.pid(); the roles that evaluate them need usage on the schema.
grant usage on schema app to anon, authenticated, service_role;

create or replace function app.pid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create or replace function app.tier() returns text language sql stable as $$ select auth.jwt()->>'tier' $$;

create table profiles (
  id uuid primary key,                              -- = profile_id
  tier text not null default 'local' check (tier in ('local','device','linked')),
  display_name text check (char_length(display_name) between 1 and 24),   -- moderated (names:lint + classifier) before shown to others
  display_name_state text not null default 'none' check (display_name_state in ('none','pending','ok','rejected')),
  created_at timestamptz not null default now(),
  registered_at timestamptz,                        -- P1
  last_seen_at timestamptz not null default now(),
  flags jsonb not null default '{}',                -- {chatOptIn, publishBan, ...}
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
create index on refresh_tokens (family);
create index on refresh_tokens (profile_id);
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
-- M05d: the log is also never truncated by the service role.
revoke truncate on audit_log from service_role;

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
