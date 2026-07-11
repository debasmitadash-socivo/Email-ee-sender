-- Audience tags: flexible labels on leads so people can be bucketed
-- (e.g. "saas", "london", "ceo", "apollo-import-jul") and campaigns can target
-- a tag directly. Lists remain the coarse bucket; tags are the flexible layer.
alter table leads add column if not exists tags text[] not null default '{}';
create index if not exists leads_tags_idx on leads using gin (tags);
