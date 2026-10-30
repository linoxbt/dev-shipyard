-- Sign-in codes are emailed by the send-code edge function. This records each
-- request so the function can refuse floods: per address and per IP.
-- (Applied to the devstation project on 30 October 2026.)
create schema if not exists private;

create table if not exists private.code_requests (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists code_requests_email_idx on private.code_requests (email_hash, created_at desc);
create index if not exists code_requests_ip_idx on private.code_requests (ip, created_at desc);
alter table private.code_requests enable row level security;

-- Returns null when the request may go ahead (and records it), or the number
-- of seconds to wait. Limits: one a minute and six an hour per address,
-- thirty an hour per IP. Old rows are pruned as it goes.
create or replace function public.claim_code_request(p_email_hash text, p_ip text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_at timestamptz;
  per_email int;
  per_ip int;
begin
  delete from private.code_requests where created_at < now() - interval '1 day';
  select max(created_at), count(*) filter (where created_at > now() - interval '1 hour')
    into last_at, per_email
    from private.code_requests where email_hash = p_email_hash;
  if last_at is not null and last_at > now() - interval '60 seconds' then
    return greatest(1, ceil(extract(epoch from (last_at + interval '60 seconds' - now())))::int);
  end if;
  if per_email >= 6 then return 3600; end if;
  select count(*) into per_ip from private.code_requests
    where ip = p_ip and created_at > now() - interval '1 hour';
  if per_ip >= 30 then return 3600; end if;
  insert into private.code_requests (email_hash, ip) values (p_email_hash, p_ip);
  return null;
end;
$$;

revoke all on function public.claim_code_request(text, text) from public, anon, authenticated;
grant execute on function public.claim_code_request(text, text) to service_role;
