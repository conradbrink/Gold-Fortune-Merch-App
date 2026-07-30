-- Server-side rate limiting for the operations that cost money.
--
-- Three routes reach a paid third party on behalf of a signed-in user, with no
-- ceiling of any kind today:
--
--   /api/geocode   — Google Places text search, then Geocoding as a fallback,
--                    once per store, up to 25 stores a request
--   /api/insights  — OpenAI gpt-5.5, a long prompt with the estate in it
--   /api/reps/invite — creates an auth user
--
-- Any authenticated rep can call these in a loop. The bill is the customer's.
--
-- Counting lives in Postgres rather than in the Next.js process because the
-- process is not a reliable place to keep a counter: serverless instances come
-- and go, several can run at once, and an in-memory tally resets on every cold
-- start. `insert … on conflict … do update` is atomic, so two simultaneous
-- requests cannot both read "9 of 10" and both proceed.

create table if not exists public.rate_limits (
  bucket       text        not null,
  -- Usually a user id. Kept as text so an IP or an org can share the table if
  -- an unauthenticated endpoint ever appears.
  subject      text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (bucket, subject, window_start)
);

-- Old windows are dead weight; this makes the sweep cheap.
create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

-- RLS on with **no policies at all**. Deny by default is the whole point: a
-- user must never be able to read their own counter, reset it, or raise a
-- limit. Only the SECURITY DEFINER function below touches this table.
alter table public.rate_limits enable row level security;

revoke all on public.rate_limits from authenticated, anon;

comment on table public.rate_limits is
  'Fixed-window counters for expensive operations. Deliberately has RLS enabled and zero policies — nothing but consume_rate_limit() may read or write it, so a user cannot inspect or reset their own quota.';

/**
 * Consumes [p_cost] units from a caller's window and says whether to proceed.
 *
 * Fixed window rather than sliding: a sliding window needs the timestamps of
 * individual events, which is more data and more contention for no benefit at
 * these limits. The cost is that a caller can spend a full window's budget at
 * the end of one window and again at the start of the next; for "don't run up
 * a Google bill" that is entirely acceptable.
 *
 * Returns `{allowed, remaining, retry_after_seconds}`. The caller turns a false
 * into an HTTP 429 with `Retry-After`.
 */
create or replace function public.consume_rate_limit(
  p_bucket          text,
  p_limit           int,
  p_window_seconds  int,
  p_cost            int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_start   timestamptz;
  v_count   int;
begin
  -- Identity comes from the verified token, never from an argument. If the
  -- caller could name their own subject they could simply use a fresh one for
  -- every request.
  v_subject := coalesce(auth.uid()::text, '');
  if v_subject = '' then
    raise exception 'Rate limiting requires an authenticated caller.'
      using errcode = '42501';
  end if;

  if p_limit <= 0 or p_window_seconds <= 0 or p_cost <= 0 then
    raise exception 'Invalid rate limit parameters.' using errcode = '22023';
  end if;

  -- Floor the clock to the window so every caller in the same window shares a
  -- row and the primary key does the locking for us.
  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, subject, window_start, count)
  values (p_bucket, v_subject, v_start, p_cost)
  on conflict (bucket, subject, window_start)
    do update set count = public.rate_limits.count + p_cost
  returning count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'retry_after_seconds',
      ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int
  );
end;
$$;

comment on function public.consume_rate_limit is
  'Atomically consumes quota for the authenticated caller and reports whether to proceed. The subject is taken from auth.uid(), never from an argument, so a caller cannot spread their usage across identities.';

revoke all on function public.consume_rate_limit(text, int, int, int) from public, anon;
grant execute on function public.consume_rate_limit(text, int, int, int) to authenticated;

/**
 * Drops windows nobody can still be inside.
 *
 * Not scheduled — pg_cron is not enabled on this project. Called opportunistically
 * from the limiter's callers; a day of rows is a handful of kilobytes, so this
 * is housekeeping rather than anything load-bearing.
 */
create or replace function public.prune_rate_limits()
returns int
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.rate_limits
     where window_start < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.prune_rate_limits() from public, anon, authenticated;
