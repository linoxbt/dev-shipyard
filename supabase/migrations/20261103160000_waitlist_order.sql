-- The waitlist is honoured in order: while people are waiting, a free place
-- goes to whoever has waited longest, not to whoever happens to sign in
-- next. An account signing in gets in on its own only when sign-ups are
-- open, there is room, and nobody (other than accounts held back by an
-- admin) joined the list before it. Everyone else waits; the waitlist page
-- asks again every two minutes, so the first in line gets the place.

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
  mine timestamptz;
begin
  if exists (select 1 from public.platform_members where owner = p_owner) then
    update public.platform_members set email = coalesce(email, p_email) where owner = p_owner;
    return jsonb_build_object('status', 'member');
  end if;

  select * into s from public.platform_access where id for update;
  select count(*) into members from public.platform_members;
  select joined_at into mine from public.waitlist where owner = p_owner;

  if coalesce(s.open, true)
    and (s.max_members is null or members < s.max_members)
    and not exists (select 1 from public.waitlist where owner = p_owner and held)
    and not exists (
      select 1 from public.waitlist w
      where not w.held and w.owner <> p_owner and w.joined_at < coalesce(mine, now())
    ) then
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
grant execute on function public.admit_account(text, text) to service_role;
