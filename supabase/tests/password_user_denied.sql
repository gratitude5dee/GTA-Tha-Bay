-- AC-12 (DL-515): a user created through Supabase Auth (password sign-up, routes 58-60) holds an `authenticated` token whose `sub`
-- has no profiles row. Such a token must read no more rows than anon on every table, and every write it attempts must change 0 rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Fixtures: a password user with no profile, plus rows in the tables that have policies or are likely targets.
insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000e1', 'password-user@example.test');
insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000e2', 'other-user@example.test');
insert into profiles (id, display_name) values ('00000000-0000-7000-8000-0000000000e2', 'Other');
insert into device_keys (kid, profile_id, public_jwk) values ('kid-pw', '00000000-0000-7000-8000-0000000000e2', '{}');
insert into cutscene_catalog (cache_key, template_id, template_ver, characters, source) values ('pw', 't', 1, '{}', 'mission:x');
insert into genai_ledger (ts, vendor, model, kind, usd_micros, settled, env) values (now(), 'fal', 'm', 'cutscene', 1, true, 'test');

-- Rows one role can read from one table (a missing privilege counts as none), and rows a statement changed (a refused statement counts as 0).
create function public._rows(t regclass) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %s', t) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;
create function public._changed(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

create temp table anon_counts as
  select c.oid::regclass as t, 0::bigint as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r';
grant all on anon_counts to public;

set local role anon;
update anon_counts set n = public._rows(t);

reset role;
set local request.jwt.claims to '{"sub":"00000000-0000-7000-8000-0000000000e1","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*) from anon_counts a where public._rows(a.t) > a.n)::int,
  0, 'no table shows the password user more rows than anon');
select is(public._rows('profiles'), 0::bigint, 'the password user reads no profile rows');
select is(
  (select coalesce(sum(public._changed(format('update %s set %I = %I', a.t, (select attname from pg_attribute where attrelid = a.t and attnum > 0 and not attisdropped and attidentity = '' and attgenerated = '' order by attnum limit 1), (select attname from pg_attribute where attrelid = a.t and attnum > 0 and not attisdropped and attidentity = '' and attgenerated = '' order by attnum limit 1)))), 0)
     from anon_counts a)::int,
  0, 'updates by the password user change 0 rows in every table');
select is(
  (select coalesce(sum(public._changed(format('delete from %s', a.t))), 0) from anon_counts a)::int,
  0, 'deletes by the password user change 0 rows in every table');
select is(
  public._changed($$insert into profiles (id) values ('00000000-0000-7000-8000-0000000000e1')$$),
  0::bigint, 'the password user cannot create a profile');
select is(
  public._changed($$insert into cutscene_catalog (cache_key, template_id, template_ver, characters, source) values ('x', 't', 1, '{}', 's')$$),
  0::bigint, 'the password user cannot write a server-only table');

reset role;
select is(
  (select count(*) from profiles)::int + (select count(*) from device_keys)::int + (select count(*) from cutscene_catalog)::int + (select count(*) from genai_ledger)::int,
  4, 'nothing was changed: the fixtures are all still there');

select * from finish();
rollback;
