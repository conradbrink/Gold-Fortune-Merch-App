-- `dashboard_layouts` claimed its constraints stopped the row being used as free
-- storage. They did not: `cardinality(widget_ids) <= 64` bounds the number of
-- elements and says nothing about their size, and `text` is unbounded — 64
-- elements of 1 KB measured 65,599 characters and was accepted. The comment was
-- a claim the schema did not back.
--
-- Two bounds added, on the total joined length rather than per element, because
-- CHECK cannot contain a subquery and `unnest` is not available to it.
--
-- `array_ndims = 1` states the other invariant: this is a list, not a matrix.
--
-- It was suggested as a way to make a multidimensional insert fail as a
-- constraint violation rather than the raw `0A000` that
-- `array_position(widget_ids, null)` raises on such input. **It does not do
-- that** — tested: a 2-D insert still reports `0A000`, because Postgres chooses
-- the order it evaluates CHECK constraints in and can reach `array_position`
-- first. The row is refused either way, and PostgREST cannot produce a 2-D array
-- from a JSON array of strings, so the constraint is kept for what it states and
-- not for the error code it was supposed to improve.
--
-- Note `array_ndims('{}') is null`, so `= 1` yields NULL and an empty layout — a
-- legitimate choice, meaning "show me nothing" — still passes. Verified.
alter table public.dashboard_layouts
  add constraint dashboard_layouts_shape_check
    check (array_ndims(widget_ids) = 1);

alter table public.dashboard_layouts
  add constraint dashboard_layouts_length_check
    check (length(array_to_string(widget_ids, ',')) <= 2048);
