-- AC-9 (second half): match_npc_memories orders a fixture by 0.5 relevance + 0.3 importance + 0.2 recency with the 518,400 scale.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- A unit vector with a 1 at position p (1-based) of 1024 dimensions.
create function public._unit(p int) returns extensions.halfvec(1024) language sql immutable as $$
  select (select array_agg(case when i = p then 1.0::real else 0.0::real end order by i) from generate_series(1, 1024) i)::extensions.halfvec(1024)
$$;

insert into auth.users (id) values ('00000000-0000-7000-8000-0000000000b1'), ('00000000-0000-7000-8000-0000000000b2');
insert into profiles (id) values ('00000000-0000-7000-8000-0000000000b1'), ('00000000-0000-7000-8000-0000000000b2');

-- now_gt = 1,000,000 game half-seconds. Query vector = unit(1).
-- m1 relevance 1, importance 1, age 0                    -> 0.5 + 0.03 + 0.2            = 0.73
-- m2 relevance 0, importance 10, age 0                   -> 0   + 0.3  + 0.2            = 0.5
-- m3 relevance 1, importance 5, age 518,400 (1 scale)    -> 0.5 + 0.15 + 0.2 e^-1       = 0.72358
-- m4 relevance 1, importance 5, age 259,200 (0.5 scale)  -> 0.5 + 0.15 + 0.2 e^-0.5     = 0.77131
-- m5 world scope ('*'), relevance 1, importance 10, age 0 -> 0.5 + 0.3  + 0.2            = 1.0
-- With the wrong scale 72*3600 = 259,200 the order would be m5, m1, m4, m3, m2; with 518,400 it is m5, m4, m1, m3, m2.
insert into npc_memory (id, profile_id, npc_id, scope, kind, text, importance, game_time, source, embedding) overriding system value values
  (1, '00000000-0000-7000-8000-0000000000b1', 'npc_a', 'pair',  'event',       'm1', 1,  1000000, 'dialogue', public._unit(1)),
  (2, '00000000-0000-7000-8000-0000000000b1', 'npc_a', 'pair',  'preference',  'm2', 10, 1000000, 'dialogue', public._unit(2)),
  (3, '00000000-0000-7000-8000-0000000000b1', 'npc_a', 'pair',  'event',       'm3', 5,  481600,  'dialogue', public._unit(1)),
  (4, '00000000-0000-7000-8000-0000000000b1', 'npc_a', 'pair',  'event',       'm4', 5,  740800,  'dialogue', public._unit(1)),
  (5, '00000000-0000-7000-8000-0000000000b1', '*',     'world', 'rumor',       'm5', 10, 1000000, 'world',    public._unit(1));
-- Rows that must never match: another NPC, another profile, an expired row.
insert into npc_memory (id, profile_id, npc_id, scope, kind, text, importance, game_time, source, embedding, expires_at) overriding system value values
  (6, '00000000-0000-7000-8000-0000000000b1', 'npc_b', 'pair', 'event', 'other npc',     10, 1000000, 'dialogue', public._unit(1), default),
  (7, '00000000-0000-7000-8000-0000000000b2', 'npc_a', 'pair', 'event', 'other profile', 10, 1000000, 'dialogue', public._unit(1), default),
  (8, '00000000-0000-7000-8000-0000000000b1', 'npc_a', 'pair', 'event', 'expired',       10, 1000000, 'dialogue', public._unit(1), now() - interval '1 day');

select is(
  (select array_agg(id order by score desc, id) from match_npc_memories('00000000-0000-7000-8000-0000000000b1', 'npc_a', public._unit(1), 1000000, 10)),
  array[5, 4, 1, 3, 2]::bigint[],
  'ordering by 0.5 relevance + 0.3 importance + 0.2 recency on the 518,400 scale');

select is((select count(*)::int from match_npc_memories('00000000-0000-7000-8000-0000000000b1', 'npc_a', public._unit(1), 1000000)), 5,
  'default k returns the pair rows and the world row, not another NPC, another profile or an expired row');

select is((select array_agg(id order by score desc, id) from match_npc_memories('00000000-0000-7000-8000-0000000000b1', 'npc_a', public._unit(1), 1000000, 2)),
  array[5, 4]::bigint[], 'k limits the result to the best rows');

select ok(abs((select score from match_npc_memories('00000000-0000-7000-8000-0000000000b1', 'npc_a', public._unit(1), 1000000, 10) where id = 3) - (0.5 + 0.15 + 0.2 * exp(-1.0))) < 1e-4,
  'a row aged exactly 518,400 half-seconds has recency e^-1');
select ok(abs((select score from match_npc_memories('00000000-0000-7000-8000-0000000000b1', 'npc_a', public._unit(1), 1000000, 10) where id = 4) - (0.5 + 0.15 + 0.2 * exp(-0.5))) < 1e-4,
  'a row aged 259,200 half-seconds has recency e^-0.5 (not e^-1: the scale is not 72*3600)');
select ok(abs((select score from match_npc_memories('00000000-0000-7000-8000-0000000000b1', 'npc_a', public._unit(1), 1000000, 10) where id = 2) - 0.5) < 1e-4,
  'an orthogonal vector scores importance and recency only');

-- A memory from the future (game_time after now_gt) counts as age 0.
insert into npc_memory (id, profile_id, npc_id, scope, kind, text, importance, game_time, source, embedding) overriding system value values
  (9, '00000000-0000-7000-8000-0000000000b2', 'npc_f', 'pair', 'event', 'future', 1, 9000000, 'dialogue', public._unit(1));
select ok(abs((select score from match_npc_memories('00000000-0000-7000-8000-0000000000b2', 'npc_f', public._unit(1), 1000000) where id = 9) - 0.73) < 1e-4,
  'recency of a future-dated memory is capped at 1');

select ok(has_function_privilege('service_role', 'match_npc_memories(uuid, text, extensions.halfvec, bigint, int)', 'execute'), 'service_role may call match_npc_memories');
select ok(not has_function_privilege('authenticated', 'match_npc_memories(uuid, text, extensions.halfvec, bigint, int)', 'execute'), 'authenticated may not call match_npc_memories');

select * from finish();
rollback;
