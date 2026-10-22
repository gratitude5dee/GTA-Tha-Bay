-- AC-1: budget_program holds the fal row with the DL-OWN-01 cap of 100,000,000 USD micros and the three alarm levels.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is((select count(*) from budget_program)::int, 1, 'budget_program has one row');
select is((select cap_usd_micros from budget_program where vendor = 'fal'), 100000000::bigint, 'the fal cap is 100,000,000 micros');
select is((select alarms from budget_program where vendor = 'fal'), array[0.5, 0.8, 1.0]::real[], 'the fal alarms are 0.5, 0.8 and 1.0');
select throws_ok($$insert into budget_program (vendor, cap_usd_micros) values ('x', -1)$$, '23514', null, 'a negative cap is refused');

select * from finish();
rollback;
