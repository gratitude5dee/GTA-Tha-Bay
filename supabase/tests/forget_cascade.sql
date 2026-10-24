-- AC-9 (first half, database side): deleting a profile row leaves no row keyed by it in any table of schema public except the append-only audit log,
-- and rows of other profiles stay. The Worker's forget job (services/edge/src/ops/forget.ts) relies on this cascade.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id) values ('00000000-0000-7000-8000-0000000000c1'), ('00000000-0000-7000-8000-0000000000c2');
insert into profiles (id) values ('00000000-0000-7000-8000-0000000000c1'), ('00000000-0000-7000-8000-0000000000c2');

-- Every table that references profiles gets a row for both profiles.
insert into device_keys (kid, profile_id, public_jwk) values ('kid-c1', '00000000-0000-7000-8000-0000000000c1', '{}'), ('kid-c2', '00000000-0000-7000-8000-0000000000c2', '{}');
insert into identities (provider, subject, profile_id) values ('openai', 'sub-c1', '00000000-0000-7000-8000-0000000000c1'), ('openai', 'sub-c2', '00000000-0000-7000-8000-0000000000c2');
insert into refresh_tokens (token_hash, family, profile_id, expires_at) values
  ('\x0c01', gen_random_uuid(), '00000000-0000-7000-8000-0000000000c1', now() + interval '30 days'),
  ('\x0c02', gen_random_uuid(), '00000000-0000-7000-8000-0000000000c2', now() + interval '30 days');
insert into age_assurance (profile_id, effective_bracket) values ('00000000-0000-7000-8000-0000000000c1', '18p'), ('00000000-0000-7000-8000-0000000000c2', '18p');
insert into npc_relationship (profile_id, npc_id, soul_version) values ('00000000-0000-7000-8000-0000000000c1', 'npc_test', 1), ('00000000-0000-7000-8000-0000000000c2', 'npc_test', 1);
insert into npc_memory (profile_id, npc_id, scope, kind, text, importance, game_time, source, embedding) values
  ('00000000-0000-7000-8000-0000000000c1', 'npc_test', 'pair', 'event', 'm', 5, 0, 'dialogue', array_fill(0.1::real, array[1024])::extensions.halfvec(1024)),
  ('00000000-0000-7000-8000-0000000000c2', 'npc_test', 'pair', 'event', 'm', 5, 0, 'dialogue', array_fill(0.1::real, array[1024])::extensions.halfvec(1024));
insert into encounter_transcripts (encounter_id, profile_id, npc_id, r2_key, turns, usd_micros, closed_at, expires_at) values
  ('ec1', '00000000-0000-7000-8000-0000000000c1', 'npc_test', 'transcripts/ec1.jsonl', 1, 1, now(), now() + interval '30 days'),
  ('ec2', '00000000-0000-7000-8000-0000000000c2', 'npc_test', 'transcripts/ec2.jsonl', 1, 1, now(), now() + interval '30 days');

-- Rows exist for profile c1 in every table that has a profile_id column.
select ok((select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'profile_id') >= 7,
  'the fixture covers a profile_id column in at least seven tables');

delete from profiles where id = '00000000-0000-7000-8000-0000000000c1';

-- Count the rows left for c1 in every public table that has a profile_id column (profiles itself keys on id).
create function public._rows_for(pid uuid) returns bigint language plpgsql as $$
declare t record; n bigint; total bigint := 0;
begin
  for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'profile_id' loop
    execute format('select count(*) from public.%I where profile_id = $1', t.table_name) into n using pid;
    total := total + n;
  end loop;
  select total + count(*) into total from public.profiles where id = pid;
  return total;
end $$;

select is(public._rows_for('00000000-0000-7000-8000-0000000000c1'), 0::bigint, 'no row keyed by the deleted profile remains in any table');
select is(public._rows_for('00000000-0000-7000-8000-0000000000c2'), 8::bigint, 'the other profile keeps its eight rows (profile, key, identity, token, age, relationship, memory, transcript)');
select is((select count(*)::int from npc_memory), 1, 'one memory is left');
select is((select count(*)::int from encounter_transcripts), 1, 'one transcript index row is left');

select * from finish();
rollback;
