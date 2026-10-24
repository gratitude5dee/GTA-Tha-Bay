-- audit_append (M06a1): each entry links to the previous row_hash and the hash recomputes from the stored fields.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(audit_append('ops-token', 'ops', 'roster.kill', 'npc', 'npc_test', '{"scope":["all"]}') > 0, 'the first append returns an id');
select ok(audit_append('ops-token', 'ops', 'flag.set', 'flag', 'ks:anthropic', null) > 0, 'the second append returns an id');

select is((select count(*)::int from audit_log where action in ('roster.kill', 'flag.set')), 2, 'both rows are stored');
select is(
  (select a.prev_hash from audit_log a where a.action = 'flag.set'),
  (select b.row_hash from audit_log b where b.action = 'roster.kill'),
  'the second row links to the first row hash');
select is(
  (select row_hash from audit_log where action = 'flag.set'),
  (select sha256(prev_hash || convert_to(jsonb_build_object('actor', actor, 'role', role, 'action', action, 'target_kind', target_kind, 'target_id', target_id,
      'details', details, 'at', to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text, 'UTF8')) from audit_log where action = 'flag.set'),
  'the row hash recomputes from the stored fields');
select ok(has_function_privilege('service_role', 'audit_append(text, text, text, text, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'audit_append(text, text, text, text, text, jsonb)', 'execute'), 'only the service role may append');

select * from finish();
rollback;
