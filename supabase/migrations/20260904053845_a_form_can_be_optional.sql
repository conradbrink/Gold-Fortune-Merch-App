-- A form is compulsory only if somebody chose that.
--
-- Today **every active template blocks check-out**. `store_detail_screen.dart`
-- computes `outstanding = templates.where((t) => !submitted.contains(t.id))`
-- over every active template and refuses the check-out button while any
-- remain. There is no per-form choice, so "compulsory" is not a property of a
-- form — it is a property of *existing*.
--
-- That is fine while every form is the daily audit. It stops being fine the
-- moment a form is occasional: a competitor price audit that only makes sense
-- in a few stores would, under that rule, hold a rep at the door of every
-- store in the country until they filled it in — and the way out of a gate
-- like that is always to answer it falsely.
--
-- So: `required`. Compulsory forms block the check-out exactly as now.
-- Optional ones appear in the rep's list, can be filled in whenever they are
-- relevant, and never hold anybody at a door.
--
-- **Existing templates are backfilled to `true` on purpose.** Every form in
-- use today is compulsory in effect, and a migration that silently made the
-- daily audit skippable would be a policy change disguised as a schema change.
-- New forms default to optional, which is the "if chosen" half: a manager
-- ticks Compulsory in the builder when they mean it.
-- Adding the column and backfilling it are one conditional, not two
-- statements. A bare `update … set required = true` would be wrong the second
-- time this file ran: it would reach back over every Optional a manager had
-- since chosen and make it compulsory again. Inside the `if not exists`, the
-- backfill happens exactly once — when the column is created — and never
-- afterwards.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'form_templates'
      and column_name = 'required'
  ) then
    alter table public.form_templates
      add column required boolean not null default false;
    update public.form_templates set required = true;
  end if;
end $$;

comment on column public.form_templates.required is
  'Compulsory: the mobile app refuses check-out while an active required form '
  'is unsubmitted for the visit. Optional forms are offered, never enforced. '
  'Existing templates were backfilled to true — that was the behaviour before '
  'the column existed.';
