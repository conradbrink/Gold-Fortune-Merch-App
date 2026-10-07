-- Rollback for delivery_template: the template and everything under it go
-- (its modules, words, settings, job types, checklist items and forms cascade).
--
-- Refuses while a company records it in `organizations.industries`: that
-- company's settings and forms are its own and stay, but its record would name
-- a template that no longer exists. Move such a company to another template
-- code first, or leave this migration in place.

do $$
begin
  if exists (select 1 from public.organizations where 'delivery' = any(industries)) then
    raise exception 'A company was created from the delivery template; not removing it.';
  end if;
end;
$$;

delete from public.industry_templates where code = 'delivery';
