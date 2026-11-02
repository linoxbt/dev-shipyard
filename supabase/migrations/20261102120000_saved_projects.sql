-- saved_projects: every project an account has, so it opens the same on any
-- device it signs in from. Written and read by this server only (routes/
-- api.projects.ts), for the signed-in account, never by a browser directly.
--
-- `body` is the project as the browser keeps it, gzipped and base64-encoded:
-- the server never reads inside it. `updated_at` is the browser's own clock
-- (ms) for the version stored, and a newer version always wins: save_project
-- keeps the stored one when what arrives is older, so two devices can never
-- roll each other back. A deleted project keeps its row, without a body, so
-- the deletion reaches the account's other devices.

create table if not exists public.saved_projects (
  owner text not null,
  id text not null,
  name text not null default '',
  updated_at bigint not null,
  deleted boolean not null default false,
  size integer not null default 0,
  body text,
  primary key (owner, id)
);
create index if not exists saved_projects_owner_idx
  on public.saved_projects (owner, updated_at desc);
alter table public.saved_projects enable row level security;
revoke all on table public.saved_projects from anon, authenticated;

-- Store one version, unless a newer one is already there. Returns the
-- version now stored, so the caller can tell whether theirs won.
create or replace function public.save_project(
  p_owner text,
  p_id text,
  p_name text,
  p_updated bigint,
  p_deleted boolean,
  p_body text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored bigint;
begin
  insert into public.saved_projects as s (owner, id, name, updated_at, deleted, size, body)
  values (
    p_owner, p_id, left(coalesce(p_name, ''), 120), p_updated, p_deleted,
    coalesce(length(p_body), 0), case when p_deleted then null else p_body end
  )
  on conflict (owner, id) do update
    set name = excluded.name,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        size = excluded.size,
        body = excluded.body
    where s.updated_at < excluded.updated_at;
  select updated_at into stored from public.saved_projects where owner = p_owner and id = p_id;
  return stored;
end;
$$;

revoke all on function public.save_project(text, text, text, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.save_project(text, text, text, bigint, boolean, text)
  to service_role;
