-- AC-1: audit_log is INSERT-only for the service role: update, delete and truncate fail.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

set local role service_role;

select lives_ok(
  $$insert into audit_log (actor, role, action, row_hash) values ('ops:test', 'ops', 'test.insert', '\x0102')$$,
  'the service role can insert');
select lives_ok($$select count(*) from audit_log$$, 'the service role can read');
select throws_ok($$update audit_log set action = 'tampered'$$, '42501', null, 'update fails for the service role');
select throws_ok($$delete from audit_log$$, '42501', null, 'delete fails for the service role');
select throws_ok($$truncate audit_log$$, '42501', null, 'truncate fails for the service role');

select * from finish();
rollback;
