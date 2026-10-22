-- AC-1: profile A cannot select or change profile B's row; anon sees nothing; a signed-in user cannot create or delete profiles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-00000000000a', 'a@example.test'),
  ('00000000-0000-7000-8000-00000000000b', 'b@example.test');
insert into profiles (id, display_name) values
  ('00000000-0000-7000-8000-00000000000a', 'Profile A'),
  ('00000000-0000-7000-8000-00000000000b', 'Profile B');

set local request.jwt.claims to '{"sub":"00000000-0000-7000-8000-00000000000a","role":"authenticated","tier":"device"}';
set local role authenticated;

select is((select count(*) from profiles)::int, 1, 'A sees exactly one profile row');
select is((select count(*) from profiles where id = '00000000-0000-7000-8000-00000000000b')::int, 0, 'A cannot select the row of B');
select is((select count(*) from profiles where id = '00000000-0000-7000-8000-00000000000a')::int, 1, 'A selects its own row');

with u as (update profiles set display_name = 'Hacked' where id = '00000000-0000-7000-8000-00000000000b' returning 1)
select is((select count(*) from u)::int, 0, 'A cannot update the row of B');
with u as (update profiles set display_name = 'Renamed A' where id = '00000000-0000-7000-8000-00000000000a' returning 1)
select is((select count(*) from u)::int, 1, 'A updates its own row');
select throws_ok(
  $$update profiles set id = '00000000-0000-7000-8000-00000000000c' where id = '00000000-0000-7000-8000-00000000000a'$$,
  '42501', null, 'A cannot move its row to another id (with check)');
select throws_ok(
  $$insert into profiles (id) values ('00000000-0000-7000-8000-00000000000d')$$,
  '42501', null, 'A cannot insert a profile (no insert policy)');
with d as (delete from profiles where id = '00000000-0000-7000-8000-00000000000a' returning 1)
select is((select count(*) from d)::int, 0, 'A cannot delete its own row (no delete policy)');

reset role;
select is((select display_name from profiles where id = '00000000-0000-7000-8000-00000000000b'), 'Profile B', 'the row of B is unchanged');

set local role anon;
select is((select count(*) from profiles)::int, 0, 'anon selects no profile');
with u as (update profiles set display_name = 'Anon' returning 1)
select is((select count(*) from u)::int, 0, 'anon updates no profile');

select * from finish();
rollback;
