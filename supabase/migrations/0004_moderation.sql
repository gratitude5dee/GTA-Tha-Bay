-- 0004_moderation (M06b1): moderation tables, uploads and the NPC builder tables.
-- moderation_item .. enforcement_action follow research/gap-trust-safety-tooling.md section 6.8 exactly, with the two changes of
-- spec/domains/09-backend-db.md section 3.4: every id is a uuid minted in the Worker, and moderation_case gains subject_snapshot jsonb.
-- The mod_subject enum carries the C12 1.1 ModSubject values (09-backend-contracts-1.1.md, npc_soul included). uploads is verbatim from
-- spec/04-data-models-db.md section 3.4; npc_draft and npc_soul follow spec/domains/04-npc-builder.md section C2.
-- Additions beyond the spec text are marked "M06b1:". RLS is on for every table and none has a policy: all are server-only.

create type mod_subject as enum ('npc_draft','npc_asset','npc_soul','mod_version','experience','forum_post','forum_attachment','chat_turn','profile');
create type mod_state   as enum ('received','scanning','auto_allowed','needs_review','quarantined','published','rejected','removed','restored');

-- No foreign key to profiles on the moderation tables: a case about a deleted profile (a CSAM-text case above all) must outlive the profile.
create table moderation_item (
  id uuid primary key,                         -- uuid v7 minted in the Worker
  subject_kind mod_subject not null, subject_id text not null,
  owner_profile_id uuid not null,
  r2_bucket text, r2_key text,                 -- null for text-only items
  sha256 bytea, pdq bytea, pdq_quality smallint, md5 bytea,   -- whole-file/whole-image hashes only; no face templates
  mime text, bytes int,
  state mod_state not null default 'received',
  visibility text not null default 'private' check (visibility in ('private','unlisted','public')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on moderation_item (sha256);
create index on moderation_item (owner_profile_id, created_at desc);
-- M06b1: the signals and cases of one subject are read by (subject_kind, subject_id).
create index on moderation_item (subject_kind, subject_id);
alter table moderation_item enable row level security;   -- server-only

create table moderation_signal (               -- one row per automated check (append-only)
  id bigserial primary key, item_id uuid not null references moderation_item(id),
  source text not null,                        -- photodna|cf_csam|hma:<bank>|openai_omni|haiku_vision|haiku_text|llama_guard|names_lint|secretlint|clamav|gltf_validator|reverse_image|google_csapi
  source_version text not null,                -- model id / rules version
  verdict text not null check (verdict in ('allow','review','block','quarantine','error')),
  scores jsonb not null default '{}', latency_ms int, created_at timestamptz not null default now()
);
-- M06b1: the draft's verdicts are read by item.
create index on moderation_signal (item_id);
alter table moderation_signal enable row level security;   -- server-only

create table moderation_case (                 -- supersedes ai-npc-runtime moderation_case
  id uuid primary key, item_id uuid references moderation_item(id),
  queue text not null check (queue in ('P0_CSAM','P0_NCII','P1_SAFETY','P1_LEGAL','P2_REVIEW','P3_REVIEW','APPEAL')),
  reason text not null, opened_by text not null,     -- 'auto:<source>' | 'report' | 'legal' | profile id
  sla_due_at timestamptz not null, statutory_due_at timestamptz,   -- sla_due_at is computed by the Worker at insert (queue table of section 6.5)
  status text not null default 'open' check (status in ('open','in_progress','decided','escalated','closed')),
  assignee uuid, created_at timestamptz not null default now(), closed_at timestamptz,
  subject_snapshot jsonb                       -- 09-backend-db.md section 3.4: what the reviewer sees even after later edits
);
create index on moderation_case (queue, status, sla_due_at);
alter table moderation_case enable row level security;   -- server-only

create table moderation_decision (             -- append-only; a reversal is a new row
  id bigserial primary key, case_id uuid not null references moderation_case(id),
  decided_by uuid not null, role text not null,
  action text not null check (action in ('approve','reject','request_changes','remove','restore','quarantine','report_ncmec','suspend_user','strike','dismiss')),
  policy_code text not null, note text, user_notice_template text,
  decided_at timestamptz not null default now()
);
alter table moderation_decision enable row level security;   -- server-only

create table user_report (
  id uuid primary key, target_kind mod_subject not null, target_id text not null,
  reporter_profile_id uuid, category text not null, note text check (length(note) <= 1000),
  case_id uuid references moderation_case(id), created_at timestamptz not null default now()
);
alter table user_report enable row level security;   -- server-only

create table enforcement_action (
  id bigserial primary key, profile_id uuid not null, kind text not null check (kind in ('strike','publish_ban','suspend','terminate','restore')),
  policy_code text not null, case_id uuid, expires_at timestamptz, created_at timestamptz not null default now()
);
alter table enforcement_action enable row level security;   -- server-only

create table uploads (                              -- one row per presigned PUT (C12 route 34)
  id uuid primary key, profile_id uuid not null references profiles(id) on delete cascade,
  purpose text not null, bucket text not null default 'ugc-staging', r2_key text not null,
  content_type text not null, declared_bytes int not null, actual_bytes int,
  state text not null default 'issued' check (state in ('issued','committed','scanning','allowed','rejected','quarantined','expired')),
  moderation_item_id uuid, created_at timestamptz not null default now(), committed_at timestamptz
);
create index on uploads (profile_id, created_at desc);
alter table uploads enable row level security;   -- server-only

-- npc_draft (04-npc-builder.md section C2). Deleting a profile deletes its drafts; unpublished drafts are purged 180 days after updated_at.
create table npc_draft (
  id uuid primary key,                         -- uuid v7 minted in the Worker
  npc_id text not null unique check (npc_id ~ '^u_[a-z0-9]{8,32}$'),   -- minted at creation
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  state text not null default 'draft' check (state in ('draft','validating','rejected_auto','text_ok','soul_generating','soul_failed','soul_ready',
    'probing','private','in_review','published','unpublished_pending_review','rejected','removed','killed')),
  rev int not null default 1,
  fields jsonb not null,                       -- DraftFields
  backstory text not null default '' check (char_length(backstory) <= 20000),   -- server-only; never sent to other players
  image_upload_ids uuid[] not null default '{}', image_descriptions jsonb not null default '[]',
  attestation text not null default 'original' check (attestation in ('original')),
  moderation jsonb not null default '{}',      -- per-stage verdicts and scores
  publishable boolean not null default true,
  soul_md text, lint jsonb not null default '[]', probes jsonb,
  -- M06b1: the jobs of DraftView.jobs and the soul version a private draft was written as (npc_soul.soul_version).
  jobs jsonb not null default '[]', soul_version int,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on npc_draft (owner_profile_id, updated_at desc);
create index on npc_draft (updated_at);
alter table npc_draft enable row level security;   -- server-only

create table npc_soul (
  npc_id text not null, soul_version int not null, primary key (npc_id, soul_version),
  origin text not null default 'user' check (origin = 'user'),
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  soul_md text not null, compiled_json jsonb not null,
  prompt_r2_key text not null, prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('private','in_review','published','unpublished_pending_review','rejected','removed','killed')),
  published_at timestamptz,
  created_at timestamptz not null default now()   -- M06b1
);
create index on npc_soul (owner_profile_id);
alter table npc_soul enable row level security;   -- server-only
