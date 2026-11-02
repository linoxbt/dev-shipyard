-- Model spend metered where the keys are, plus hardening from the audit.
--
-- model_usage: one row per model call made through the website's proxy
-- (routes/api.model.ts), written by this server only. Premium spend, and so
-- the launch credit balance, is the sum of these rows: it no longer depends on
-- a browser polling to see a turn finish, nor on figures a sandbox reports.

create table if not exists public.model_usage (
  id bigint generated always as identity primary key,
  owner text not null,
  workspace text not null default '',
  model text not null,
  premium boolean not null default false,
  cost_usd numeric(12, 6) not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists model_usage_owner_premium_idx on public.model_usage (owner) where premium;
create index if not exists model_usage_created_idx on public.model_usage (created_at desc);
alter table public.model_usage enable row level security;

-- Connected accounts: a refresh lease so two turns never refresh the same
-- grant at once (a rotated refresh token used twice revokes the grant on some
-- providers), a status for a grant that needs reconnecting, when it was last
-- refreshed (created_at stays the connection date), and provider details
-- needed to revoke it (Vercel's configuration id).
alter table public.connectors add column if not exists refreshed_at timestamptz;
alter table public.connectors add column if not exists refresh_lease timestamptz;
alter table public.connectors add column if not exists status text not null default 'ok';
alter table public.connectors add column if not exists meta jsonb;

-- Someone to write back to about a Pro request.
alter table public.account_plans add column if not exists contact text;

-- One launch credit per person, not per address: the normalised email
-- (plus-addressing and Gmail dots removed), hashed.
alter table public.credit_claims add column if not exists identity text;
create unique index if not exists credit_claims_identity_key on public.credit_claims (identity) where identity is not null;

create or replace function public.claim_launch_credit_v2(p_owner text, p_identity text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed int;
begin
  perform pg_advisory_xact_lock(424242);
  if exists (select 1 from public.credit_claims where owner = p_owner)
     or (p_identity is not null and exists (select 1 from public.credit_claims where identity = p_identity)) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;
  select count(*) into claimed from public.credit_claims;
  if claimed >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'all_claimed');
  end if;
  insert into public.credit_claims (owner, amount_usd, identity) values (p_owner, 5, p_identity);
  return jsonb_build_object('ok', true, 'left', 20 - claimed - 1);
end;
$$;

create or replace function public.account_access(p_owner text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', coalesce((select plan from public.account_plans where owner = p_owner), 'free'),
    'pro_requested', (select pro_requested_at is not null from public.account_plans where owner = p_owner),
    'claimed', coalesce((select amount_usd from public.credit_claims where owner = p_owner), 0),
    'spent', coalesce((select sum(cost_usd) from public.model_usage where owner = p_owner and premium), 0),
    'slots_left', greatest(0, 20 - (select count(*) from public.credit_claims))
  );
$$;

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
    'cost_usd', (select coalesce(sum(cost_usd), 0) from public.model_usage),
    'model_calls', (select count(*) from public.model_usage),
    'premium_cost_usd', (select coalesce(sum(cost_usd), 0) from public.model_usage where premium),
    'credits_claimed', (select count(*) from public.credit_claims),
    'pro_accounts', (select count(*) from public.account_plans where plan = 'pro'),
    'pro_requests', (select count(*) from public.account_plans where pro_requested_at is not null and plan = 'free'),
    'by_model', (select coalesce(jsonb_object_agg(model, n), '{}'::jsonb) from (select model, count(*) n from public.agent_turns group by model) m),
    'generated_at', now()
  );
$$;

-- Row level security with no policies already blocks the public and
-- signed-in roles; take away their table grants as well, as a second wall.
revoke all on table public.account_plans, public.credit_claims, public.agent_turns,
  public.site_daily, public.connectors, public.model_usage from anon, authenticated;

revoke all on function public.claim_launch_credit_v2(text, text) from public, anon, authenticated;
revoke all on function public.claim_launch_credit(text) from public, anon, authenticated;
revoke all on function public.account_access(text) from public, anon, authenticated;
revoke all on function public.devstation_stats() from public, anon, authenticated;
grant execute on function public.claim_launch_credit_v2(text, text) to service_role;
grant execute on function public.account_access(text) to service_role;
grant execute on function public.devstation_stats() to service_role;
-- claim_launch_credit(text), the first version, stays for older deployments
-- until they are gone; the site now calls claim_launch_credit_v2.
