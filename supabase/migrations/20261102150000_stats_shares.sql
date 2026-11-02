-- stats_shares: read-only links to DevStation's figures, made by an admin on
-- the stats page. Whoever has a link can view the figures and download them,
-- with every account replaced by a pseudonym, and nothing else; the admin can
-- revoke a link at any time, after which it opens nothing.
--
-- The link's secret is stored twice: hashed (sha256, for looking it up) and
-- sealed with the server's key (so the admin can copy the link again). Never
-- in the clear. Written and read by the server with the service role only.

create table if not exists public.stats_shares (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  token_sealed text not null,
  label text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  views integer not null default 0
);
alter table public.stats_shares enable row level security;
revoke all on table public.stats_shares from anon, authenticated;
