-- How much of a limit the caller has left, without using any of it.
--
-- Ask (the assistant panel) shows "7 questions left this hour, 37 today" when
-- it opens. Before this, the web read the caller's own `rate_limits` rows with
-- the service role, because the table is readable by nobody through RLS. That
-- put the service-role key on a path every signed-in user triggers. This is
-- the narrow alternative, the read-only twin of `consume_rate_limit`:
--
--   * the subject is the caller (auth.uid()), never an argument, so nobody can
--     read anybody else's counter;
--   * it only reads: resetting or raising a limit stays impossible, and the
--     table itself stays unreadable (security_regression 16);
--   * the window is floored to the clock exactly as `consume_rate_limit`
--     floors it, so the two always agree on which window is current.
--
-- Security definer for the same reason as `consume_rate_limit`: the table has
-- RLS on and no policies at all.

create or replace function public.rate_limit_left(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int
)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject text;
  v_start   timestamptz;
  v_count   int;
begin
  v_subject := coalesce(auth.uid()::text, '');
  if v_subject = '' then
    raise exception 'Rate limiting requires an authenticated caller.'
      using errcode = '42501';
  end if;

  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'Invalid rate limit parameters.' using errcode = '22023';
  end if;

  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  select r.count into v_count
    from public.rate_limits r
   where r.bucket = p_bucket
     and r.subject = v_subject
     and r.window_start = v_start;

  return greatest(p_limit - coalesce(v_count, 0), 0);
end;
$$;

comment on function public.rate_limit_left(text, int, int) is
  'How much of a limit the authenticated caller has left in the current window, without consuming any. Read-only twin of consume_rate_limit; the subject is auth.uid(), never an argument.';

revoke all on function public.rate_limit_left(text, int, int) from public, anon;
grant execute on function public.rate_limit_left(text, int, int) to authenticated;

-- Every company has the limiter (core), like consume_rate_limit.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'rate_limit_left', 'core')
on conflict do nothing;
