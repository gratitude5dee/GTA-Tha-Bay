-- 0002_genai (M05d): GenAI index, ledger and telemetry rollup tables. Section 3.2 of spec/domains/09-backend-db.md
-- plus the S05 pipeline tables of spec/04-data-models-db.md section 3.2a (DL-198). All tables are server-only.
-- Additions beyond the spec text are marked "M05d:".

create table cutscene_catalog (                     -- keys our own mission/fight/race scripts may request (C09); loaded from the release cutscene-index (CutsceneRef -> key) built by tools/assets in CI (S05/S03)
  cache_key text primary key, template_id text not null, template_ver int not null,
  characters text[] not null, source text not null, -- 'mission:<id>' | 'fight:<a>:<b>' | ...
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
  usd_micros bigint not null, settled boolean not null, request_id text, job_id text, env text not null,
  -- M05d: the export is idempotent per (env, job_id). Rows without a job_id (NULLs are distinct) are never deduplicated.
  constraint genai_ledger_env_job_id_key unique (env, job_id)
);
create index on genai_ledger (ts);
create index on genai_ledger (vendor, ts);
create table budget_daily (day date not null, vendor text not null, ceiling_usd_micros bigint not null,
  spent_usd_micros bigint not null, max_level smallint not null, primary key (day, vendor));
create table telemetry_daily (                      -- aggregates only, no sessionId; 25 months
  day date not null, name text not null, build text not null, device_class text not null, tier text not null,
  os_major smallint not null, count bigint not null, metrics jsonb not null,   -- {p50:..., p95:...}
  primary key (day, name, build, device_class, tier, os_major)
);
alter table cutscene_catalog enable row level security;
alter table cutscenes enable row level security;
alter table genai_ledger enable row level security;
alter table budget_daily enable row level security;
alter table telemetry_daily enable row level security;   -- all server-only

-- S05 pipeline tables (spec/04-data-models-db.md section 3.2a).
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
alter table gen_run enable row level security;
alter table gen_job enable row level security;
alter table asset_index enable row level security;
alter table bark_index enable row level security;
alter table budget_program enable row level security;   -- all server-only

insert into budget_program (vendor, cap_usd_micros, alarms) values ('fal', 100000000, '{0.5,0.8,1.0}') on conflict (vendor) do nothing;
