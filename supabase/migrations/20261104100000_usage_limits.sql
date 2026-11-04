-- Usage limits an admin sets, enforced by the model proxy on every call
-- (routes/api.model.ts) and when a message is sent (lib/db/access.server.ts).
--
-- usage_settings (one row): the launch credit (how much, for how many
-- accounts), the free model's daily allowance (0: none, so every call is paid
-- from credit and the whole credit can be used), and the limits on the free
-- plan: the most one run (one message's work) may spend, the most a day may
-- spend, and how many runs a day. Null means no limit.
--
-- account_limits: the same limits for one account, set by an admin; a field
-- left null there uses the setting above. paused stops the account's model
-- use altogether.
--
-- model_usage.turn names the run a call belongs to (its workspace and when
-- it started), so a run's spend can be added up.
--
-- usage_state() is what the proxy asks before each call.

create table if not exists public.usage_settings (
  id boolean primary key default true check (id),
  launch_credit_usd numeric(10, 2) not null default 5 check (launch_credit_usd >= 0),
  launch_slots integer check (launch_slots is null or launch_slots >= 0),
  free_daily_usd numeric(10, 4) not null default 0 check (free_daily_usd >= 0),
  run_limit_usd numeric(10, 4) check (run_limit_usd is null or run_limit_usd > 0),
  daily_limit_usd numeric(10, 4) check (daily_limit_usd is null or daily_limit_usd > 0),
  runs_per_day integer check (runs_per_day is null or runs_per_day > 0),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.usage_settings (id, launch_credit_usd, launch_slots, free_daily_usd, run_limit_usd, daily_limit_usd)
values (true, 5, 20, 0, 2, 5)
on conflict (id) do nothing;

create table if not exists public.account_limits (
  owner text primary key,
  run_limit_usd numeric(10, 4) check (run_limit_usd is null or run_limit_usd > 0),
  daily_limit_usd numeric(10, 4) check (daily_limit_usd is null or daily_limit_usd > 0),
  runs_per_day integer check (runs_per_day is null or runs_per_day > 0),
  free_daily_usd numeric(10, 4) check (free_daily_usd is null or free_daily_usd >= 0),
  -- An account with its own limits set "off" (no limit) rather than "use the
  -- default": these say so.
  no_run_limit boolean not null default false,
  no_daily_limit boolean not null default false,
  no_runs_limit boolean not null default false,
  paused boolean not null default false,
  note text not null default '' check (length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.model_usage add column if not exists turn text;
create index if not exists model_usage_owner_created_idx on public.model_usage (owner, created_at desc);
create index if not exists model_usage_turn_idx on public.model_usage (turn) where turn is not null;

alter table public.usage_settings enable row level security;
alter table public.account_limits enable row level security;
revoke all on table public.usage_settings from anon, authenticated;
revoke all on table public.account_limits from anon, authenticated;

-- What an account used today (UTC) and in this run, and how many runs it
-- started today. A call counts at what it was charged, or at its cost when it
-- was free, so a limit holds whoever pays.
create or replace function public.usage_state(p_owner text, p_turn text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select * from public.model_usage
    where owner = p_owner and created_at >= (now() at time zone 'utc')::date
  )
  select jsonb_build_object(
    'day_spent', coalesce((select sum(greatest(coalesce(billed_usd, 0), cost_usd)) from today), 0),
    'run_spent', coalesce((
      select sum(greatest(coalesce(billed_usd, 0), cost_usd)) from public.model_usage
      where p_turn is not null and turn = p_turn
    ), 0),
    'runs_today', (select count(distinct turn) from today where turn is not null),
    'run_seen', p_turn is not null and exists (select 1 from today where turn = p_turn)
  );
$$;
revoke all on function public.usage_state(text, text) from public, anon, authenticated;
grant execute on function public.usage_state(text, text) to service_role;

-- The launch credit follows the settings: its amount and how many accounts.
create or replace function public.claim_launch_credit_v2(p_owner text, p_identity text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed int;
  amount numeric;
  slots int;
begin
  perform pg_advisory_xact_lock(424242);
  select launch_credit_usd, launch_slots into amount, slots from public.usage_settings where id;
  amount := coalesce(amount, 5);
  if amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'all_claimed');
  end if;
  if exists (select 1 from public.credit_claims where owner = p_owner)
     or (p_identity is not null and exists (select 1 from public.credit_claims where identity = p_identity)) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  select count(*) into claimed from public.credit_claims;
  if slots is not null and claimed >= slots then
    return jsonb_build_object('ok', false, 'reason', 'all_claimed');
  end if;
  insert into public.credit_claims (owner, amount_usd, identity) values (p_owner, amount, p_identity);
  return jsonb_build_object(
    'ok', true,
    'left', case when slots is null then null else slots - claimed - 1 end
  );
end;
$$;
revoke all on function public.claim_launch_credit_v2(text, text) from public, anon, authenticated;
grant execute on function public.claim_launch_credit_v2(text, text) to service_role;

-- How many launch credits are left follows the settings too.
create or replace function public.account_access(p_owner text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.account_plans where owner = p_owner),
  pro as (
    select exists (
      select 1 from p
      where plan = 'pro' and (billing is null or pro_until > now())
    ) as active,
    exists (select 1 from p where plan = 'pro' and billing is null) as comp
  )
  select jsonb_build_object(
    'plan', case when (select active from pro) then 'pro' else 'free' end,
    'unlimited', (select comp from pro),
    'billing', (select billing from p),
    'pro_until', (select pro_until from p),
    'portal', (select stripe_customer is not null from p),
    'subscribed', (select stripe_subscription is not null from p),
    'pro_requested', (select pro_requested_at is not null from p),
    'launch', coalesce((select amount_usd from public.credit_claims where owner = p_owner), 0),
    'claimed',
      coalesce((select amount_usd from public.credit_claims where owner = p_owner), 0)
      + coalesce((select sum(amount_usd) from public.credit_ledger where owner = p_owner), 0),
    'spent', coalesce((
      select sum(coalesce(billed_usd, case when premium then cost_usd else 0 end))
      from public.model_usage where owner = p_owner
    ), 0),
    'free_used_today', coalesce((
      select sum(cost_usd) from public.model_usage
      where owner = p_owner and not premium and coalesce(billed_usd, 0) = 0
        and created_at >= (now() at time zone 'utc')::date
    ), 0),
    'slots_left', coalesce((
      select case
        when s.launch_credit_usd <= 0 then 0
        when s.launch_slots is null then 1000000
        else greatest(0, s.launch_slots - (select count(*) from public.credit_claims))
      end
      from public.usage_settings s where s.id
    ), greatest(0, 20 - (select count(*) from public.credit_claims)))
  );
$$;
revoke all on function public.account_access(text) from public, anon, authenticated;
grant execute on function public.account_access(text) to service_role;

-- For the admins' limits page: every member with their credit, what they
-- used in all and today, and how many runs they started today.
create or replace function public.admin_usage_overview()
returns table (
  owner text,
  email text,
  plan text,
  unlimited boolean,
  credit numeric,
  spent numeric,
  day_spent numeric,
  runs_today bigint,
  last_used timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.owner,
    m.email,
    case when p.plan = 'pro' and (p.billing is null or p.pro_until > now()) then 'pro' else 'free' end,
    coalesce(p.plan = 'pro' and p.billing is null, false),
    coalesce((select amount_usd from public.credit_claims c where c.owner = m.owner), 0)
      + coalesce((select sum(amount_usd) from public.credit_ledger l where l.owner = m.owner), 0),
    coalesce((
      select sum(coalesce(billed_usd, case when premium then cost_usd else 0 end))
      from public.model_usage u where u.owner = m.owner
    ), 0),
    coalesce((
      select sum(greatest(coalesce(billed_usd, 0), cost_usd)) from public.model_usage u
      where u.owner = m.owner and u.created_at >= (now() at time zone 'utc')::date
    ), 0),
    (
      select count(distinct turn) from public.model_usage u
      where u.owner = m.owner and u.turn is not null
        and u.created_at >= (now() at time zone 'utc')::date
    ),
    (select max(created_at) from public.model_usage u where u.owner = m.owner)
  from public.platform_members m
  left join public.account_plans p on p.owner = m.owner
  order by 9 desc nulls last, m.admitted_at desc
  limit 1000;
$$;
revoke all on function public.admin_usage_overview() from public, anon, authenticated;
grant execute on function public.admin_usage_overview() to service_role;
