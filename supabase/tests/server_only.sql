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
  array['profiles']::name[], 'only profiles has policies; every other table is server-only');

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
