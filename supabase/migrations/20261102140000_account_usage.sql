-- account_usage(owner, days): one account's credit and usage page (routes/
-- credits.tsx through api/credits): its spend per day by model, totals for
-- the period and the one before, each model's calls and tokens, the latest
-- model calls, and what was added to its credit. Days are UTC. Read by the
-- server with the service role only, for the signed-in account.

create or replace function public.account_usage(p_owner text, p_days integer default 30)
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
  u as (
    select created_at, (created_at at time zone 'UTC')::date as day, model, premium,
           coalesce(cost_usd, 0) as cost, coalesce(input_tokens, 0) as input,
           coalesce(output_tokens, 0) as output, workspace
    from public.model_usage
    where owner = p_owner
  ),
  cur as (select u.* from u, b where u.day >= b.start_day),
  prev as (select u.* from u, b where u.day >= b.prev_start and u.day < b.start_day),
  days as (select generate_series(b.start_day, current_date, interval '1 day')::date as day from b)
select jsonb_build_object(
  'range', (select jsonb_build_object('days', days, 'start', start_day, 'end', current_date) from b),
  'totals', jsonb_build_object(
    'cost', (select coalesce(sum(cost), 0) from cur),
    'cost_prev', (select coalesce(sum(cost), 0) from prev),
    'billed', (select coalesce(sum(cost), 0) from cur where premium),
    'billed_prev', (select coalesce(sum(cost), 0) from prev where premium),
    'calls', (select count(*) from cur),
    'calls_prev', (select count(*) from prev),
    'input', (select coalesce(sum(input), 0) from cur),
    'output', (select coalesce(sum(output), 0) from cur),
    'tokens_prev', (select coalesce(sum(input + output), 0) from prev)
  ),
  'series', (
    select coalesce(jsonb_agg(x order by x.day, x.model), '[]'::jsonb) from (
      select d.day, c.model, sum(c.cost) as cost, count(c.*) as calls
      from days d join cur c on c.day = d.day
      group by d.day, c.model
    ) x
  ),
  'days', (select coalesce(jsonb_agg(day order by day), '[]'::jsonb) from days),
  'models', (
    select coalesce(jsonb_agg(m order by m.cost desc, m.calls desc), '[]'::jsonb) from (
      select model, bool_or(premium) as premium, count(*) as calls,
             sum(input) as input, sum(output) as output, sum(cost) as cost
      from cur group by model
    ) m
  ),
  'recent', (
    select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
      select created_at, model, premium, input, output, cost, workspace
      from u order by created_at desc limit 50
    ) r
  ),
  'credits', (
    select coalesce(jsonb_agg(c order by c.claimed_at desc), '[]'::jsonb) from (
      select claimed_at, amount_usd from public.credit_claims where owner = p_owner
    ) c
  ),
  'plan', (
    select jsonb_build_object('plan', plan, 'updated_at', updated_at, 'pro_requested_at', pro_requested_at)
    from public.account_plans where owner = p_owner
  )
);
$$;

revoke all on function public.account_usage(text, integer) from public, anon, authenticated;
grant execute on function public.account_usage(text, integer) to service_role;
