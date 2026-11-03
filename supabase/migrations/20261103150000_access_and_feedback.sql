-- Who may use DevStation, and what they think of it.
--
-- platform_access (one row): whether new accounts get in on their own
-- ("open") and how many accounts may have access in all ("max_members"; null
-- for no limit). platform_members: the accounts with access. waitlist: the
-- accounts that signed in while DevStation was closed or full, oldest first,
-- until an admin lets them in. admit_account decides, atomically, at every
-- sign-in (routes/api.access.session.ts).
--
-- feedback: what members tell DevStation after building or publishing an
-- app (routes/api.feedback.ts), read by the admins.
--
-- Written and read by this server only.

create table if not exists public.platform_access (
  id boolean primary key default true check (id),
  open boolean not null default true,
  max_members integer check (max_members is null or max_members >= 0),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.platform_access (id) values (true) on conflict (id) do nothing;

create table if not exists public.platform_members (
  owner text primary key,
  email text,
  admitted_at timestamptz not null default now(),
  -- 'grandfathered', 'open' (got in on their own) or 'admin' (let in).
  via text not null default 'open',
  admitted_by text
);

create table if not exists public.waitlist (
  owner text primary key,
  email text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Put back on the list by an admin: waits even while there is room.
  held boolean not null default false
);
create index if not exists waitlist_joined_idx on public.waitlist (joined_at);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  email text,
  rating integer not null check (rating between 1 and 5),
  recommend integer check (recommend between 0 and 10),
  built text not null default '' check (length(built) <= 2000),
  worked text not null default '' check (length(worked) <= 4000),
  improve text not null default '' check (length(improve) <= 4000),
  project text check (length(project) <= 200),
  site_url text check (length(site_url) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_owner_idx on public.feedback (owner);

alter table public.platform_access enable row level security;
alter table public.platform_members enable row level security;
alter table public.waitlist enable row level security;
alter table public.feedback enable row level security;
revoke all on table public.platform_access from anon, authenticated;
revoke all on table public.platform_members from anon, authenticated;
revoke all on table public.waitlist from anon, authenticated;
revoke all on table public.feedback from anon, authenticated;

-- Everyone who already used DevStation keeps access.
insert into public.platform_members (owner, via)
select distinct owner, 'grandfathered' from (
  select owner from public.account_plans
  union select owner from public.saved_projects
  union select owner from public.model_usage
  union select owner from public.agent_turns
  union select owner from public.connectors
  union select owner from public.sites
  union select owner from public.credit_claims
) known
where owner ~ '^0x[0-9a-f]{40}$'
on conflict (owner) do nothing;

-- One sign-in: 'member' (already in), 'admitted' (in now), or 'waitlisted'
-- with the account's place in line. Locks the settings row, so two sign-ins
-- at once cannot both take the last place.
create or replace function public.admit_account(p_owner text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.platform_access;
  members integer;
  place integer;
begin
  if exists (select 1 from public.platform_members where owner = p_owner) then
    update public.platform_members set email = coalesce(email, p_email) where owner = p_owner;
    return jsonb_build_object('status', 'member');
  end if;

  select * into s from public.platform_access where id for update;
  select count(*) into members from public.platform_members;

  if coalesce(s.open, true)
    and (s.max_members is null or members < s.max_members)
    and not exists (select 1 from public.waitlist where owner = p_owner and held) then
    insert into public.platform_members (owner, email, via) values (p_owner, p_email, 'open')
    on conflict (owner) do nothing;
    delete from public.waitlist where owner = p_owner;
    return jsonb_build_object('status', 'admitted');
  end if;

  insert into public.waitlist as w (owner, email) values (p_owner, p_email)
  on conflict (owner) do update set last_seen_at = now(), email = excluded.email;
  select count(*) into place from public.waitlist
  where joined_at <= (select joined_at from public.waitlist where owner = p_owner);
  return jsonb_build_object('status', 'waitlisted', 'place', place);
end;
$$;
revoke all on function public.admit_account(text, text) from public, anon, authenticated;

-- Let accounts in from the waitlist (an admin's choice, past any limit).
create or replace function public.grant_access(p_owners text[], p_by text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.platform_members (owner, email, via, admitted_by)
  select w.owner, w.email, 'admin', p_by from public.waitlist w where w.owner = any(p_owners)
  on conflict (owner) do nothing;
  get diagnostics n = row_count;
  delete from public.waitlist where owner = any(p_owners);
  return n;
end;
$$;
revoke all on function public.grant_access(text[], text) from public, anon, authenticated;

-- Take an account's access away: it goes back on the waitlist, held there.
create or replace function public.revoke_access(p_owner text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.platform_members;
begin
  delete from public.platform_members where owner = p_owner returning * into m;
  if m.owner is null then return false; end if;
  insert into public.waitlist (owner, email, held) values (p_owner, coalesce(m.email, ''), true)
  on conflict (owner) do update set held = true;
  return true;
end;
$$;
revoke all on function public.revoke_access(text) from public, anon, authenticated;
grant execute on function public.admit_account(text, text) to service_role;
grant execute on function public.grant_access(text[], text) to service_role;
grant execute on function public.revoke_access(text) to service_role;
