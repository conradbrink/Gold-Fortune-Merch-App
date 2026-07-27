alter table public.routes
  add column scheduled_start_at timestamptz,
  add column scheduled_end_at timestamptz;
