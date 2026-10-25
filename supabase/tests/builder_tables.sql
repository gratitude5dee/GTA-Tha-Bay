-- M06b1 AC-10 (database side): the 0004 tables are server-only, a deleted profile takes its drafts, souls and uploads along, the
-- moderation rows stay (a case outlives the profile it is about), and the draft constraints hold.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id) values ('00000000-0000-7000-8000-0000000000d1'), ('00000000-0000-7000-8000-0000000000d2');
insert into profiles (id) values ('00000000-0000-7000-8000-0000000000d1'), ('00000000-0000-7000-8000-0000000000d2');

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname in ('moderation_item','moderation_signal','moderation_case','moderation_decision','user_report','enforcement_action','uploads','npc_draft','npc_soul')),
  array['enforcement_action','moderation_case','moderation_decision','moderation_item','moderation_signal','npc_draft','npc_soul','uploads','user_report'],
  'RLS is enabled on all nine new tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in
  ('moderation_item','moderation_signal','moderation_case','moderation_decision','user_report','enforcement_action','uploads','npc_draft','npc_soul')),
  0, 'none of the nine has a policy (server-only)');
select is((select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'mod_subject'),
  array['npc_draft','npc_asset','npc_soul','mod_version','experience','forum_post','forum_attachment','chat_turn','profile'],
  'mod_subject carries the C12 1.1 ModSubject values');
select has_column('public', 'moderation_case', 'subject_snapshot', 'moderation_case has subject_snapshot');

insert into npc_draft (id, npc_id, owner_profile_id, fields, backstory) values
  ('00000000-0000-7000-8000-0000000000e1', 'u_d1d1d1d1', '00000000-0000-7000-8000-0000000000d1', '{}', 'story'),
  ('00000000-0000-7000-8000-0000000000e2', 'u_d2d2d2d2', '00000000-0000-7000-8000-0000000000d2', '{}', 'story');
insert into npc_soul (npc_id, soul_version, owner_profile_id, soul_md, compiled_json, prompt_r2_key, prompt_sha256, status) values
  ('u_d1d1d1d1', 1, '00000000-0000-7000-8000-0000000000d1', 'x', '{}', 'k1', repeat('b', 64), 'private'),
  ('u_d2d2d2d2', 1, '00000000-0000-7000-8000-0000000000d2', 'x', '{}', 'k2', repeat('c', 64), 'private');
insert into uploads (id, profile_id, purpose, r2_key, content_type, declared_bytes) values
  ('00000000-0000-7000-8000-0000000000e3', '00000000-0000-7000-8000-0000000000d1', 'npc_image', 'k', 'image/png', 1);
insert into moderation_item (id, subject_kind, subject_id, owner_profile_id) values
  ('00000000-0000-7000-8000-0000000000e4', 'npc_draft', 'e1', '00000000-0000-7000-8000-0000000000d1');
insert into moderation_case (id, item_id, queue, reason, opened_by, sla_due_at, subject_snapshot) values
  ('00000000-0000-7000-8000-0000000000e5', '00000000-0000-7000-8000-0000000000e4', 'P0_CSAM', 'text', 'auto:openai_omni', now() + interval '4 hours', '{"x":1}');

-- Constraints.
select throws_ok($$insert into npc_draft (id, npc_id, owner_profile_id, fields, state) values (gen_random_uuid(), 'u_badstate1', '00000000-0000-7000-8000-0000000000d1', '{}', 'nope')$$,
  '23514', null, 'an unknown draft state is refused');
select throws_ok($$insert into npc_draft (id, npc_id, owner_profile_id, fields, backstory) values (gen_random_uuid(), 'u_toolong01', '00000000-0000-7000-8000-0000000000d1', '{}', repeat('a', 20001))$$,
  '23514', null, 'a backstory over 20,000 characters is refused');
select throws_ok($$insert into npc_draft (id, npc_id, owner_profile_id, fields) values (gen_random_uuid(), 'u_d1d1d1d1', '00000000-0000-7000-8000-0000000000d1', '{}')$$,
  '23505', null, 'an npc id is unique');
select throws_ok($$insert into moderation_case (id, queue, reason, opened_by, sla_due_at) values (gen_random_uuid(), 'P9', 'r', 'x', now())$$,
  '23514', null, 'an unknown queue is refused');

-- Deleting profile d1 cascades to its drafts, souls and uploads; the moderation case stays.
delete from profiles where id = '00000000-0000-7000-8000-0000000000d1';
select is((select count(*)::int from npc_draft where owner_profile_id = '00000000-0000-7000-8000-0000000000d1'), 0, 'the deleted profile has no draft left');
select is((select count(*)::int from npc_soul where owner_profile_id = '00000000-0000-7000-8000-0000000000d1') + (select count(*)::int from uploads where profile_id = '00000000-0000-7000-8000-0000000000d1'),
  0, 'the deleted profile has no soul or upload left');
select is((select count(*)::int from npc_draft) + (select count(*)::int from npc_soul) + (select count(*)::int from moderation_case), 3,
  'the other profile keeps its draft and soul, and the moderation case outlives the profile it is about');

select * from finish();
rollback;
