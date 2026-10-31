-- Applied to the devstation Supabase project on 30 October 2026 through the
-- Supabase connector. See src/lib/db/ for how the website uses it.
-- DevStation's own records. Every table is reached only by the website's
-- server with the service role: row level security is on and there are no
-- policies, so the public (anon) key and signed-in users cannot read or
-- write any of it directly. "owner" is DevStation's account id (a hash of
-- the email, lib/auth/account.server.ts), never the email itself.

create table if not exists public.account_plans (
  owner text primary key,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  pro_requested_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_claims (
  owner text primary key,
  amount_usd numeric(10, 4) not null default 5,
  claimed_at timestamptz not null default now()
);

create table if not exists public.agent_turns (
  id bigint generated always as identity primary key,
  owner text not null,
  workspace text not null,
  turn integer not null,
  model text not null,
  mode text not null,
  phase text not null,
  steps integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  files_changed integer not null default 0,
  premium boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace, turn)
);
create index if not exists agent_turns_owner_idx on public.agent_turns (owner, created_at desc);
create index if not exists agent_turns_created_idx on public.agent_turns (created_at desc);

create table if not exists public.site_daily (
  day date not null default current_date,
  metric text not null,
  count bigint not null default 0,
  primary key (day, metric)
);

create table if not exists public.connectors (
  owner text not null,
  provider text not null,
  token_enc text not null,
  label text,
  created_at timestamptz not null default now(),
  primary key (owner, provider)
);

alter table public.account_plans enable row level security;
alter table public.credit_claims enable row level security;
alter table public.agent_turns enable row level security;
alter table public.site_daily enable row level security;
alter table public.connectors enable row level security;

-- The launch offer: $5 for each of the first 20 accounts that claim it.
-- Serialised with an advisory lock so the 21st claim cannot slip in.
create or replace function public.claim_launch_credit(p_owner text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed int;
begin
  perform pg_advisory_xact_lock(424242);
  if exists (select 1 from public.credit_claims where owner = p_owner) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  select count(*) into claimed from public.credit_claims;
  if claimed >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'all_claimed');
  end if;
  insert into public.credit_claims (owner, amount_usd) values (p_owner, 5);
  return jsonb_build_object('ok', true, 'left', 20 - claimed - 1);
end;
$$;

-- What one account may use: its plan, credit claimed, premium spend.
create or replace function public.account_access(p_owner text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', coalesce((select plan from public.account_plans where owner = p_owner), 'free'),
    'pro_requested', (select pro_requested_at is not null from public.account_plans where owner = p_owner),
    'claimed', coalesce((select amount_usd from public.credit_claims where owner = p_owner), 0),
    'spent', coalesce((select sum(cost_usd) from public.agent_turns where owner = p_owner and premium), 0),
    'slots_left', greatest(0, 20 - (select count(*) from public.credit_claims))
  );
$$;

create or replace function public.bump_metric(p_metric text, p_by bigint default 1)
returns void language sql security definer set search_path = '' as $$
  insert into public.site_daily (day, metric, count) values (current_date, p_metric, p_by)
  on conflict (day, metric) do update set count = public.site_daily.count + excluded.count;
$$;

-- Totals for the stats page, including sign-ups from Supabase Auth.
create or replace function public.devstation_stats()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accounts_confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'builders', (select count(distinct owner) from public.agent_turns),
    'turns', (select count(*) from public.agent_turns),
    'turns_finished', (select count(*) from public.agent_turns where phase = 'idle'),
    'workspaces', (select count(distinct workspace) from public.agent_turns),
    'steps', (select coalesce(sum(steps), 0) from public.agent_turns),
    'cost_usd', (select coalesce(sum(cost_usd), 0) from public.agent_turns),
    'credits_claimed', (select count(*) from public.credit_claims),
    'pro_accounts', (select count(*) from public.account_plans where plan = 'pro'),
    'pro_requests', (select count(*) from public.account_plans where pro_requested_at is not null and plan = 'free'),
    'by_model', (select coalesce(jsonb_object_agg(model, n), '{}'::jsonb) from (select model, count(*) n from public.agent_turns group by model) m),
    'generated_at', now()
  );
$$;

revoke all on function public.claim_launch_credit(text) from public, anon, authenticated;
revoke all on function public.account_access(text) from public, anon, authenticated;
revoke all on function public.bump_metric(text, bigint) from public, anon, authenticated;
revoke all on function public.devstation_stats() from public, anon, authenticated;
grant execute on function public.claim_launch_credit(text) to service_role;
grant execute on function public.account_access(text) to service_role;
grant execute on function public.bump_metric(text, bigint) to service_role;
grant execute on function public.devstation_stats() to service_role;
