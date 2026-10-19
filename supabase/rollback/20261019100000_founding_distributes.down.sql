-- Rollback of 20261019100000_founding_distributes: the answers to "What do you
-- distribute?" are lost with the column.
alter table public.founding_applications drop column if exists distributes;
