-- devstation_dashboard, with revenue: payments per period and per day (top-ups
-- and Pro), paying accounts, active subscriptions and passes, and what usage
-- charged to credit earned over its model cost.

create or replace function public.devstation_dashboard(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with
  b as (
    select d as days,
           current_date - (d - 1) as start_day,
           current_date - (2 * d - 1) as prev_start
    from (select greatest(1, least(coalesce(p_days, 30), 365)) as d) x
  ),
  people as (
    select u.email::text as email,
           u.created_at,
           u.email_confirmed_at,
           u.last_sign_in_at,
           '0x' || left(encode(sha256(convert_to('devstation-account:' || lower(trim(u.email)), 'UTF8')), 'hex'), 40) as owner
    from auth.users u
    where u.email is not null
  ),
  t as (
    select owner, workspace, created_at, (created_at at time zone 'UTC')::date as day,
           model, phase, coalesce(steps, 0) as steps, coalesce(cost_usd, 0) as cost, premium
    from public.agent_turns
  ),
  cur as (select t.* from t, b where t.day >= b.start_day),
  prev as (select t.* from t, b where t.day >= b.prev_start and t.day < b.start_day),
  usage_cur as (
    select u.* from public.model_usage u, b
    where (u.created_at at time zone 'UTC')::date >= b.start_day
  ),
  usage_prev as (
    select u.* from public.model_usage u, b
    where (u.created_at at time zone 'UTC')::date >= b.prev_start
      and (u.created_at at time zone 'UTC')::date < b.start_day
  ),
  site as (select day, metric, count from public.site_daily),
  days as (
    select generate_series(b.start_day, current_date, interval '1 day')::date as day from b
  ),
  series as (
    select d.day,
      (select count(*) from people p where (p.created_at at time zone 'UTC')::date = d.day) as signups,
      (select count(distinct owner) from t where t.day = d.day) as builders,
      (select count(*) from t where t.day = d.day) as turns,
      (select count(*) from t where t.day = d.day and t.phase = 'error') as failed,
      (select coalesce(sum(cost), 0) from t where t.day = d.day and not coalesce(t.premium, false)) as cost_free,
      (select coalesce(sum(cost), 0) from t where t.day = d.day and coalesce(t.premium, false)) as cost_premium,
      (select coalesce(sum(count), 0) from site s where s.day = d.day and s.metric = 'visits') as visits,
      (select coalesce(sum(count), 0) from site s where s.day = d.day and s.metric = 'projects_created') as projects_created,
      (select coalesce(sum(count), 0) from site s where s.day = d.day and s.metric = 'messages') as messages,
      (select coalesce(sum(amount_usd), 0) from public.payments pay
        where (pay.created_at at time zone 'UTC')::date = d.day and pay.kind = 'topup') as revenue_topup,
      (select coalesce(sum(amount_usd), 0) from public.payments pay
        where (pay.created_at at time zone 'UTC')::date = d.day and pay.kind = 'pro') as revenue_pro
    from days d
  ),
  plans as (select owner, plan, pro_requested_at from public.account_plans),
  claims as (select distinct owner from public.credit_claims),
  by_owner as (
    select owner, count(*) as turns, count(distinct workspace) as projects,
           sum(cost) as cost, max(created_at) as last_active
    from cur group by owner
  )
select jsonb_build_object(
  'range', (select jsonb_build_object('days', days, 'start', start_day, 'end', current_date, 'prev_start', prev_start) from b),
  'kpis', jsonb_build_object(
    'accounts', (select count(*) from people),
    'new_accounts', (select count(*) from people p, b where (p.created_at at time zone 'UTC')::date >= b.start_day),
    'new_accounts_prev', (select count(*) from people p, b where (p.created_at at time zone 'UTC')::date >= b.prev_start and (p.created_at at time zone 'UTC')::date < b.start_day),
    'builders', (select count(distinct owner) from cur),
    'builders_prev', (select count(distinct owner) from prev),
    'turns', (select count(*) from cur),
    'turns_prev', (select count(*) from prev),
    'finished', (select count(*) from cur where phase = 'idle'),
    'finished_prev', (select count(*) from prev where phase = 'idle'),
    'failed', (select count(*) from cur where phase = 'error'),
    'failed_prev', (select count(*) from prev where phase = 'error'),
    'cost', (select coalesce(sum(cost), 0) from cur),
    'cost_prev', (select coalesce(sum(cost), 0) from prev),
    'credit_used', (select coalesce(sum(coalesce(billed_usd, case when premium then cost_usd else 0 end)), 0) from usage_cur),
    'credit_used_prev', (select coalesce(sum(coalesce(billed_usd, case when premium then cost_usd else 0 end)), 0) from usage_prev),
    'visits', (select coalesce(sum(count), 0) from site, b where site.day >= b.start_day and metric = 'visits'),
    'visits_prev', (select coalesce(sum(count), 0) from site, b where site.day >= b.prev_start and site.day < b.start_day and metric = 'visits'),
    'projects_saved', (select count(*) from public.saved_projects where not deleted),
    'credits_claimed', (select count(*) from public.credit_claims),
    'credits_total', 20,
    'pro_accounts', (select count(*) from plans where plan = 'pro'),
    'revenue', (select coalesce(sum(amount_usd), 0) from public.payments pay, b
      where (pay.created_at at time zone 'UTC')::date >= b.start_day),
    'revenue_prev', (select coalesce(sum(amount_usd), 0) from public.payments pay, b
      where (pay.created_at at time zone 'UTC')::date >= b.prev_start
        and (pay.created_at at time zone 'UTC')::date < b.start_day),
    'paying_accounts', (select count(distinct owner) from public.payments pay, b
      where (pay.created_at at time zone 'UTC')::date >= b.start_day),
    'paying_accounts_prev', (select count(distinct owner) from public.payments pay, b
      where (pay.created_at at time zone 'UTC')::date >= b.prev_start
        and (pay.created_at at time zone 'UTC')::date < b.start_day),
    'subscribers', (select count(*) from public.account_plans
      where plan = 'pro' and billing = 'subscription' and stripe_subscription is not null and pro_until > now()),
    'pro_passes', (select count(*) from public.account_plans
      where plan = 'pro' and billing = 'pass' and pro_until > now()),
    'usage_billed', (select coalesce(sum(billed_usd), 0) from usage_cur where billed_usd > 0),
    'usage_billed_cost', (select coalesce(sum(cost_usd), 0) from usage_cur where billed_usd > 0),
    'customers_ever', (select count(distinct owner) from public.payments),
    'pro_requests', (select count(*) from plans where plan = 'free' and pro_requested_at is not null)
  ),
  'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.day), '[]'::jsonb) from series s),
  'funnel', jsonb_build_object(
    'signed_up', (select count(*) from people),
    'confirmed', (select count(*) from people where email_confirmed_at is not null),
    'built', (select count(*) from people p where exists (select 1 from t where t.owner = p.owner)),
    'claimed', (select count(*) from people p where exists (select 1 from claims c where c.owner = p.owner)),
    'pro', (select count(*) from people p where exists (select 1 from plans pl where pl.owner = p.owner and pl.plan = 'pro'))
  ),
  'models', (
    select coalesce(jsonb_agg(m order by m.turns desc), '[]'::jsonb) from (
      select model, count(*) as turns,
             count(*) filter (where phase = 'error') as failed,
             round(avg(steps)::numeric, 1) as avg_steps,
             coalesce(sum(cost), 0) as cost
      from cur group by model
    ) m
  ),
  'top_accounts', (
    select coalesce(jsonb_agg(x order by x.turns desc), '[]'::jsonb) from (
      select coalesce(p.email, o.owner) as account, o.owner, o.turns, o.projects, o.cost, o.last_active,
             coalesce(pl.plan, 'free') as plan
      from by_owner o
      left join people p on p.owner = o.owner
      left join plans pl on pl.owner = o.owner
      order by o.turns desc
      limit 10
    ) x
  ),
  'recent_accounts', (
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select p.email as account, p.owner, p.created_at, p.email_confirmed_at is not null as confirmed,
             p.last_sign_in_at,
             (select count(*) from t where t.owner = p.owner) as turns,
             coalesce(pl.plan, 'free') as plan
      from people p
      left join plans pl on pl.owner = p.owner
      order by p.created_at desc
      limit 12
    ) x
  ),
  'generated_at', now()
);
$$;

revoke all on function public.devstation_dashboard(integer) from public, anon, authenticated;
grant execute on function public.devstation_dashboard(integer) to service_role;
