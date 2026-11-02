-- Billing: what people pay, what it buys, and what they are charged.
--
-- payments        every payment a gateway confirmed (Stripe, Paystack), once
-- credit_ledger   every credit added to an account: top-ups, the credit Pro
--                 includes each month, adjustments (launch credit stays in
--                 credit_claims, as before)
-- account_plans   Pro now has an end (pro_until) and a source (billing):
--                 'subscription' (Stripe, renews), 'pass' (30 days, paid once)
--                 or null: granted by an admin, with no end and no limits
-- model_usage     billed_usd: what the account was charged for the call
--                 (model cost plus the platform margin); null when nothing
--                 was charged (the free model within its daily allowance)
--
-- apply_payment() records a payment and what it buys in one transaction, and
-- does nothing the second time it sees the same payment: gateways deliver
-- webhooks more than once, and the browser's return confirms them too.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  provider text not null check (provider in ('stripe', 'paystack')),
  provider_ref text not null,
  kind text not null check (kind in ('topup', 'pro')),
  amount_usd numeric(12, 2) not null,
  currency text not null default 'usd',
  amount_minor bigint,
  created_at timestamptz not null default now(),
  meta jsonb,
  unique (provider, provider_ref)
);
create index if not exists payments_owner_idx on public.payments (owner, created_at desc);
create index if not exists payments_created_idx on public.payments (created_at desc);
alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  owner text not null,
  amount_usd numeric(12, 4) not null,
  kind text not null check (kind in ('topup', 'pro_included', 'adjustment', 'refund')),
  reference text not null unique,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_owner_idx on public.credit_ledger (owner, created_at desc);
alter table public.credit_ledger enable row level security;
revoke all on table public.credit_ledger from anon, authenticated;

alter table public.account_plans add column if not exists billing text;
alter table public.account_plans add column if not exists pro_until timestamptz;
alter table public.account_plans add column if not exists stripe_customer text;
alter table public.account_plans add column if not exists stripe_subscription text;

alter table public.model_usage add column if not exists billed_usd numeric(12, 6);
create index if not exists model_usage_owner_day_idx on public.model_usage (owner, created_at desc);

-- What an account may use and has left. Pro counts while it has not ended
-- (or was granted by an admin: unlimited). Credit is launch credit plus the
-- ledger; spent is what calls were charged (older premium calls, from before
-- billed_usd, at their cost). free_used_today is the free model's cost today
-- (UTC) that was not charged, against the daily allowance.
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
    'slots_left', greatest(0, 20 - (select count(*) from public.credit_claims))
  );
$$;

create or replace function public.apply_payment(
  p_owner text,
  p_provider text,
  p_ref text,
  p_kind text,
  p_amount numeric,
  p_currency text,
  p_minor bigint,
  p_included numeric,
  p_period_end timestamptz,
  p_billing text,
  p_customer text,
  p_subscription text,
  p_meta jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer;
  current_until timestamptz;
  next_until timestamptz;
begin
  insert into public.payments (owner, provider, provider_ref, kind, amount_usd, currency, amount_minor, meta)
  values (p_owner, p_provider, p_ref, p_kind, p_amount, coalesce(p_currency, 'usd'), p_minor, p_meta)
  on conflict (provider, provider_ref) do nothing;
  get diagnostics added = row_count;
  if added = 0 then
    return false;
  end if;

  if p_kind = 'topup' then
    insert into public.credit_ledger (owner, amount_usd, kind, reference, note)
    values (p_owner, p_amount, 'topup', p_provider || ':' || p_ref, 'Credit top-up');
    return true;
  end if;

  if coalesce(p_included, 0) > 0 then
    insert into public.credit_ledger (owner, amount_usd, kind, reference, note)
    values (p_owner, p_included, 'pro_included', p_provider || ':' || p_ref, 'Credit included with Pro');
  end if;

  select pro_until into current_until from public.account_plans where owner = p_owner;
  next_until := case
    when p_period_end is not null then greatest(coalesce(current_until, now()), p_period_end)
    else greatest(coalesce(current_until, now()), now()) + interval '30 days'
  end;

  insert into public.account_plans (owner, plan, billing, pro_until, stripe_customer, stripe_subscription, updated_at)
  values (p_owner, 'pro', p_billing, next_until, p_customer, p_subscription, now())
  on conflict (owner) do update set
    plan = 'pro',
    -- Pro an admin granted has no end and stays that way.
    billing = case
      when public.account_plans.plan = 'pro' and public.account_plans.billing is null then null
      else excluded.billing
    end,
    pro_until = excluded.pro_until,
    stripe_customer = coalesce(excluded.stripe_customer, public.account_plans.stripe_customer),
    stripe_subscription = coalesce(excluded.stripe_subscription, public.account_plans.stripe_subscription),
    updated_at = now();
  return true;
end;
$$;

revoke all on function public.account_access(text) from public, anon, authenticated;
grant execute on function public.account_access(text) to service_role;
revoke all on function public.apply_payment(text, text, text, text, numeric, text, bigint, numeric, timestamptz, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_payment(text, text, text, text, numeric, text, bigint, numeric, timestamptz, text, text, text, jsonb)
  to service_role;
