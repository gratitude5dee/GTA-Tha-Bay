-- M06a4 AC-6 (database side): the two statements of DELETE /me/npc-memory (services/edge/src/data/supabase/maintenance.ts forgetNpcMemory) remove
-- exactly the rows they name. With an npc_id they delete that pair's memories and its relationship row; without one, every pair of the profile. Another
-- profile's rows and the player's other NPCs stay. The world-scope row ('*') of the profile is a memory like any other and goes with the profile-wide delete.
-- Row level security: an authenticated player reads only their own memories and can delete none (writes are service-only).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id) values ('00000000-0000-7000-8000-0000000000f1'), ('00000000-0000-7000-8000-0000000000f2');
insert into profiles (id) values ('00000000-0000-7000-8000-0000000000f1'), ('00000000-0000-7000-8000-0000000000f2');
insert into npc_relationship (profile_id, npc_id, soul_version, summary) values
  ('00000000-0000-7000-8000-0000000000f1', 'npc_a', 1, 'a'),
  ('00000000-0000-7000-8000-0000000000f1', 'npc_b', 1, 'b'),
  ('00000000-0000-7000-8000-0000000000f2', 'npc_a', 1, 'other player');
insert into npc_memory (profile_id, npc_id, scope, kind, text, importance, game_time, source, embedding) values
  ('00000000-0000-7000-8000-0000000000f1', 'npc_a', 'pair',  'event',       'a1', 5, 0, 'dialogue', array_fill(0.1::real, array[1024])::extensions.halfvec(1024)),
  ('00000000-0000-7000-8000-0000000000f1', 'npc_a', 'pair',  'preference',  'a2', 5, 0, 'summary',  array_fill(0.2::real, array[1024])::extensions.halfvec(1024)),
  ('00000000-0000-7000-8000-0000000000f1', 'npc_b', 'pair',  'event',       'b1', 5, 0, 'dialogue', array_fill(0.3::real, array[1024])::extensions.halfvec(1024)),
  ('00000000-0000-7000-8000-0000000000f1', '*',     'world', 'rumor',       'w1', 5, 0, 'world',    array_fill(0.4::real, array[1024])::extensions.halfvec(1024)),
  ('00000000-0000-7000-8000-0000000000f2', 'npc_a', 'pair',  'event',       'o1', 5, 0, 'dialogue', array_fill(0.5::real, array[1024])::extensions.halfvec(1024));

-- Row level security first, while every row exists: the player f1 sees four memories (their own), never f2's, and deletes none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-7000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from npc_memory), 4, 'an authenticated player reads only their own memories');
delete from npc_memory;
select is((select count(*)::int from npc_memory), 4, 'an authenticated player cannot delete a memory (writes are service-only)');
reset role;

-- One NPC.
delete from npc_memory where profile_id = '00000000-0000-7000-8000-0000000000f1' and npc_id = 'npc_a';
delete from npc_relationship where profile_id = '00000000-0000-7000-8000-0000000000f1' and npc_id = 'npc_a';
select is((select array_agg(text order by text) from npc_memory where profile_id = '00000000-0000-7000-8000-0000000000f1'), array['b1', 'w1'],
  'forgetting npc_a removes its pair memories and keeps the other NPC and the world row');
select is((select array_agg(npc_id order by npc_id) from npc_relationship where profile_id = '00000000-0000-7000-8000-0000000000f1'), array['npc_b'],
  'forgetting npc_a removes its relationship row only');
select is((select count(*)::int from npc_memory where profile_id = '00000000-0000-7000-8000-0000000000f2'), 1, 'another profile keeps its memory');
select is((select count(*)::int from npc_relationship where profile_id = '00000000-0000-7000-8000-0000000000f2'), 1, 'another profile keeps its relationship');

-- Every NPC.
delete from npc_memory where profile_id = '00000000-0000-7000-8000-0000000000f1';
delete from npc_relationship where profile_id = '00000000-0000-7000-8000-0000000000f1';
select is((select count(*)::int from npc_memory where profile_id = '00000000-0000-7000-8000-0000000000f1') +
          (select count(*)::int from npc_relationship where profile_id = '00000000-0000-7000-8000-0000000000f1'), 0,
  'forgetting every NPC leaves nothing of the profile');
select is((select count(*)::int from npc_memory) + (select count(*)::int from npc_relationship), 2, 'and nothing of the other profile is touched');

select * from finish();
rollback;
