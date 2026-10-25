-- AC-1: RLS is on for every table; every table without a policy (all but profiles) shows 0 rows to anon and authenticated.
-- A role that has no table privilege at all counts as seeing 0 rows (new Supabase projects may stop granting public tables to the API roles).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id) values ('00000000-0000-7000-8000-0000000000a1');
insert into profiles (id) values ('00000000-0000-7000-8000-0000000000a1');
insert into device_keys (kid, profile_id, public_jwk) values ('kid-1', '00000000-0000-7000-8000-0000000000a1', '{}');
insert into identities (provider, subject, profile_id) values ('openai', 'sub-1', '00000000-0000-7000-8000-0000000000a1');
insert into refresh_tokens (token_hash, family, profile_id, expires_at) values ('\x01', gen_random_uuid(), '00000000-0000-7000-8000-0000000000a1', now() + interval '30 days');
insert into staff_roles (profile_id, scope, granted_by) values ('00000000-0000-7000-8000-0000000000a1', 'ops', '00000000-0000-7000-8000-0000000000a1');
insert into idempotency_keys (key, route, status, response) values (gen_random_uuid(), 'x', 200, '{}');
insert into audit_log (actor, role, action, row_hash) values ('t', 't', 't', '\x01');
insert into age_assurance (profile_id, effective_bracket) values ('00000000-0000-7000-8000-0000000000a1', '18p');
insert into cutscene_catalog (cache_key, template_id, template_ver, characters, source) values ('k', 't', 1, '{}', 'mission:x');
insert into cutscenes (cache_key, status, r2_prefix, endpoint_id, endpoint_updated_at, workflow_instance) values ('k', 'ready', 'cutscenes/k/', 'e', 'u', 'w');
insert into genai_ledger (ts, vendor, model, kind, usd_micros, settled, env) values (now(), 'fal', 'm', 'cutscene', 1, true, 'test');
insert into budget_daily values (current_date, 'fal', 1, 1, 0);
insert into telemetry_daily values (current_date, 'n', 'b', 'd', 't', 1, 1, '{}');
insert into gen_run (id, requested_by, env, budget_usd_micros) values (gen_random_uuid(), 'x', 'test', 1);
insert into gen_job (id, job_key, kind, endpoint_key, env, asset_ref, state, budget_usd_micros) values (gen_random_uuid(), 'jk', 'k', 'e', 'test', 'a/b', 's', 1);
insert into asset_index (ref, sha256, status) values ('a/b', repeat('a', 64), 'active');
insert into bark_index values ('v', 'k');
-- M06a1: the 0003 tables.
insert into npc_relationship (profile_id, npc_id, soul_version) values ('00000000-0000-7000-8000-0000000000a1', 'npc_test', 1);
insert into npc_memory (profile_id, npc_id, scope, kind, text, importance, game_time, source, embedding)
  values ('00000000-0000-7000-8000-0000000000a1', 'npc_test', 'pair', 'event', 'm', 5, 0, 'dialogue', array_fill(0.1::real, array[1024])::extensions.halfvec(1024));
insert into encounter_transcripts (encounter_id, profile_id, npc_id, r2_key, turns, usd_micros, closed_at, expires_at)
  values ('e1', '00000000-0000-7000-8000-0000000000a1', 'npc_test', 'transcripts/e1.jsonl', 1, 1, now(), now() + interval '30 days');
insert into roster_flag (npc_id, killed, stand_in, set_by) values ('npc_test', true, 'character/stand_in', '00000000-0000-7000-8000-0000000000a1');
insert into likeness_subject (id, real_name, default_tier) values ('ls1', 'Test Person', 'parody');
insert into consent_record (id, subject_id, signatory_name, signatory_capacity, scopes, media, use_description, term_start, revocation_terms,
  counsel_represented, evidence_r2_key, evidence_sha256, approved_by, approved_at)
  values ('cr1', 'ls1', 'Test Person', 'self', '{marketing}', '{image}', 'test', current_date, 'on request', false, 'k', repeat('a', 64),
  '00000000-0000-7000-8000-0000000000a1', now());
insert into consent_event (consent_id, kind, actor) values ('cr1', 'granted', 't');
-- M06b1: the 0004 tables.
insert into moderation_item (id, subject_kind, subject_id, owner_profile_id) values ('00000000-0000-7000-8000-0000000000b1', 'npc_draft', 'd1', '00000000-0000-7000-8000-0000000000a1');
insert into moderation_signal (item_id, source, source_version, verdict) values ('00000000-0000-7000-8000-0000000000b1', 'names_lint', 'x', 'allow');
insert into moderation_case (id, item_id, queue, reason, opened_by, sla_due_at, subject_snapshot)
  values ('00000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000b1', 'P2_REVIEW', 'r', 'auto:test', now() + interval '72 hours', '{}');
insert into moderation_decision (case_id, decided_by, role, action, policy_code) values ('00000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000a1', 'reviewer', 'dismiss', 'p');
insert into user_report (id, target_kind, target_id, category) values ('00000000-0000-7000-8000-0000000000b3', 'npc_soul', 'u_abcdefgh', 'other');
insert into enforcement_action (profile_id, kind, policy_code) values ('00000000-0000-7000-8000-0000000000a1', 'strike', 'p');
insert into uploads (id, profile_id, purpose, r2_key, content_type, declared_bytes)
  values ('00000000-0000-7000-8000-0000000000b4', '00000000-0000-7000-8000-0000000000a1', 'npc_image', 'k', 'image/png', 1);
insert into npc_draft (id, npc_id, owner_profile_id, fields) values ('00000000-0000-7000-8000-0000000000b5', 'u_abcdefgh', '00000000-0000-7000-8000-0000000000a1', '{}');
insert into npc_soul (npc_id, soul_version, owner_profile_id, soul_md, compiled_json, prompt_r2_key, prompt_sha256, status)
  values ('u_abcdefgh', 1, '00000000-0000-7000-8000-0000000000a1', 'x', '{}', 'souls/u_abcdefgh/1/soul.prompt.txt', repeat('a', 64), 'private');

-- Rows a role can read from one table; a missing privilege counts as none.
create function public._visible_rows(t regclass) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %s', t) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int,
  0, 'RLS is enabled on every table of schema public');
select is(
  (select array_agg(distinct tablename order by tablename) from pg_policies where schemaname = 'public'),
  array['npc_memory','npc_relationship','profiles']::name[], 'only profiles and the two self-read NPC tables have policies; every other table is server-only');

set local role anon;
select is(
  (select coalesce(sum(public._visible_rows(c.oid)), 0) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r')::int,
  0, 'anon reads 0 rows from every table');

reset role;
set local request.jwt.claims to '{"sub":"00000000-0000-7000-8000-0000000000ff","role":"authenticated","tier":"device"}';
set local role authenticated;
select is(
  (select coalesce(sum(public._visible_rows(c.oid)), 0) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'profiles')::int,
  0, 'authenticated reads 0 rows from every server-only table');
select is(public._visible_rows('profiles'), 0::bigint, 'authenticated without a profile of its own reads 0 profile rows');

reset role;
select is((select count(*) from device_keys)::int, 1, 'the fixtures exist (the zeros above are RLS, not empty tables)');
select is((select count(*) from budget_program)::int, 1, 'budget_program holds its seed row');

select * from finish();
rollback;
