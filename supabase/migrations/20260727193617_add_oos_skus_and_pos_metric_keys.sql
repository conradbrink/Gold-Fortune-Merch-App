-- Two audit questions carry real signal but had no metric_key, so the only way
-- to find them was by label — the exact fragility metric_key exists to avoid
-- (a manager renaming a question would silently break the report).
--
-- Matching on label is acceptable here precisely because it happens once, at
-- backfill time, the same way the original metric_key backfill did. All query
-- code keys off metric_key from now on.
alter table public.form_fields drop constraint form_fields_metric_key_check;

alter table public.form_fields add constraint form_fields_metric_key_check
  check (
    metric_key is null or metric_key = any (array[
      'in_stock', 'facings', 'shelf_position', 'planogram_ok', 'price_correct',
      'promo_display', 'damaged_expired', 'coupons',
      'oos_skus',      -- free-text list of out-of-stock SKUs
      'pos_materials'  -- point-of-sale material presence
    ])
  );

update public.form_fields
   set metric_key = 'oos_skus'
 where metric_key is null
   and field_type = 'text'
   and label ilike '%out of stock%';

update public.form_fields
   set metric_key = 'pos_materials'
 where metric_key is null
   and field_type = 'multiple_choice'
   and label ilike '%point-of-sale%';
