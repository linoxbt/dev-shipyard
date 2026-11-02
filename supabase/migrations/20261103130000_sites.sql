-- sites: apps people publish on DevStation, served at <slug>.devstation.online
-- (and at a domain of their own, once it points here). Each publish uploads the
-- project's built files to the public "sites" storage bucket under
-- <site id>/<deploy id>/, and the site serves the current deploy
-- (src/lib/hosting/serve.server.ts). Written by the server only.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'),
  name text not null default '',
  workspace text,
  current_deploy text,
  files integer not null default 0,
  bytes bigint not null default 0,
  custom_domain text unique,
  domain_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deployed_at timestamptz
);
create index if not exists sites_owner_idx on public.sites (owner);
create index if not exists sites_workspace_idx on public.sites (workspace);
alter table public.sites enable row level security;
revoke all on table public.sites from anon, authenticated;

-- The files themselves: public to read (they are public websites), written
-- only with the service role.
insert into storage.buckets (id, name, public, file_size_limit)
values ('sites', 'sites', true, 52428800)
on conflict (id) do nothing;
