-- app_templates: apps the community built that an admin has put on the
-- Templates tab, beside the built-in ones. Each row is a copy of the
-- project's files (and its build, when it had one) taken when the admin
-- picked it, without the chat or anything private: later changes by the
-- builder do not reach the template until an admin refreshes it, and deleting
-- the project does not take the template down.
--
-- `body` is {files, dist} as JSON, gzipped and base64-encoded, the way
-- saved_projects keeps a project. Written and read by this server only
-- (lib/templates/templates.server.ts).

create table if not exists public.app_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  blurb text not null default '' check (length(blurb) <= 240),
  source_owner text not null,
  source_project text not null,
  body text not null,
  size integer not null default 0,
  files integer not null default 0,
  position integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_owner, source_project)
);
create index if not exists app_templates_position_idx on public.app_templates (position, created_at);
alter table public.app_templates enable row level security;
revoke all on table public.app_templates from anon, authenticated;
