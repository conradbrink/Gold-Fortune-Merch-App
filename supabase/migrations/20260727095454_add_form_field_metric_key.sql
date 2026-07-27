-- Compliance KPIs need to know which field *means* "in stock" or "planogram ok".
-- Matching on the label would break silently the moment a manager renames a
-- question in the form builder, showing 0% rather than an error.
alter table public.form_fields add column metric_key text;

alter table public.form_fields add constraint form_fields_metric_key_check
  check (metric_key is null or metric_key in (
    'in_stock', 'facings', 'shelf_position', 'planogram_ok',
    'price_correct', 'promo_display', 'damaged_expired', 'coupons'
  ));

-- One field per metric per template.
create unique index form_fields_template_metric_idx
  on public.form_fields (form_template_id, metric_key)
  where metric_key is not null;

update public.form_fields set metric_key = case sort_order
    when 1  then 'in_stock'
    when 2  then 'facings'
    when 3  then 'shelf_position'
    when 4  then 'planogram_ok'
    when 6  then 'price_correct'
    when 8  then 'promo_display'
    when 10 then 'damaged_expired'
    when 11 then 'coupons'
  end
where form_template_id = '3de65e08-382e-424c-acc7-9db1be5e5f46'
  and sort_order in (1, 2, 3, 4, 6, 8, 10, 11);
