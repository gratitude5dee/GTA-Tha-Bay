-- Stand-in for the parts of a Supabase database that the migrations and pgTAP files rely on: the three API roles, schema auth
-- with auth.jwt() and auth.users, and the default table privileges of schema public. check:db loads it only in --pg-url mode
-- (a plain Postgres 16 or 17 with the pgtap extension, for machines without Docker); the Supabase local stack already has all of it.
-- Safe to run twice.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
-- Supabase puts schema extensions on the search path of its roles; new sessions of this database get the same.
do $$ begin execute format('alter database %I set search_path to public, extensions', current_database()); end $$;
grant usage on schema public to anon, authenticated, service_role;
grant create on schema public to service_role;

-- Supabase grants new public tables to the API roles; RLS is what denies them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
