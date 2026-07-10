-- DANGER: wipes the entire `public` schema (all app tables + data).
-- Safe ONLY on a fresh project with no real data. It does NOT touch Supabase
-- internals (auth, storage, realtime live in their own schemas).
--
-- Use this if a partial or conflicting run left the database in a bad state
-- (e.g. the "cannot change name of input parameter" error from a pre-existing
-- helper function). Run this, then run schema.sql once.

drop schema public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
