-- An 11th industry template: delivery and courier companies.
--
-- Why: the owner asked for delivery companies to be offered alongside the ten
-- suggested templates (7 Oct 2026). They carry other people's parcels to
-- addresses on daily routes, so they are not the Distribution template (which
-- sells its own stock: orders, products, a warehouse). Data only, like the
-- other ten: words, modules, settings, job types with their checklists, forms.
--
-- Proof of delivery is a recipient's name and a photo for now: forms have no
-- signature field yet. The job types record `requires_signature` so it can be
-- switched on when signature capture is built.
--
-- Rollback: supabase/rollback/<this version>_delivery_template.down.sql.

insert into public.industry_templates (code, name, description, default_visit_frequency, sort_order) values
  ('delivery', 'Delivery & courier', 'Parcel, courier and last-mile delivery on daily routes.', 'weekly', 95);

-- Proof of work and the vehicle logbook are not built yet: kept so the template
-- is complete, switched on for a company only once built.
insert into public.template_modules (template_code, module_code) values
  ('delivery', 'recurring_jobs'),
  ('delivery', 'checklists_forms'),
  ('delivery', 'reports'),
  ('delivery', 'proof_of_work'),
  ('delivery', 'vehicle_logbook');

insert into public.template_terminology (template_code, term_key, singular, plural) values
  ('delivery', 'site', 'Stop', 'Stops'),
  ('delivery', 'job', 'Delivery', 'Deliveries'),
  ('delivery', 'staff', 'Driver', 'Drivers'),
  ('delivery', 'client', 'Customer', 'Customers'),
  ('delivery', 'day_plan', 'Today''s deliveries', 'Today''s deliveries');

insert into public.template_settings (template_code, setting_key, value) values
  -- Drivers are followed on the map while they drive.
  ('delivery', 'gps_ping_interval_minutes', '2'),
  -- A drop-off is often at a gate or a reception desk.
  ('delivery', 'checkin_radius_m', '150'),
  -- A two-minute drop-off is normal, not a short visit to question.
  ('delivery', 'short_visit_minutes', '0');

insert into public.template_job_types
  (template_code, code, name, default_duration_minutes, min_photos, requires_signature, sort_order) values
  ('delivery', 'parcel_delivery', 'Parcel delivery', 10, 1, true, 10),
  ('delivery', 'collection', 'Collection', 10, 1, false, 20);

insert into public.template_checklist_items
  (template_code, job_type_code, sort_order, item_text, required, photo_required) values
  ('delivery', 'parcel_delivery', 10, 'Parcel matches the waybill', true, false),
  ('delivery', 'parcel_delivery', 20, 'Handed to the recipient', true, false),
  ('delivery', 'parcel_delivery', 30, 'Photo at the door', true, true),
  ('delivery', 'collection', 10, 'Parcels counted against the waybill', true, false),
  ('delivery', 'collection', 20, 'Packaging intact', true, false),
  ('delivery', 'collection', 30, 'Photo of the parcels collected', true, true);

insert into public.template_forms (template_code, code, name, description, fields, sort_order) values
  ('delivery', 'proof_of_delivery', 'Proof of delivery', 'Who received it, and a photo of the hand-over.',
   '[{"label":"Recipient''s name","field_type":"text","required":true},
     {"label":"Waybill or reference number","field_type":"text","required":false},
     {"label":"Photo of the hand-over","field_type":"photo","required":true},
     {"label":"Notes","field_type":"text","required":false}]', 10),
  ('delivery', 'failed_delivery', 'Failed delivery', 'Why it could not be delivered.',
   '[{"label":"Reason","field_type":"multiple_choice","required":true,"options":["Nobody home","Wrong address","Refused","No access","Other"]},
     {"label":"Notes","field_type":"text","required":false},
     {"label":"Photo","field_type":"photo","required":false}]', 20),
  ('delivery', 'vehicle_check', 'Daily vehicle check', 'Before the first stop of the day.',
   '[{"label":"Odometer reading","field_type":"number","required":true},
     {"label":"Fuel level","field_type":"multiple_choice","required":true,"options":["Full","3/4","1/2","1/4","Nearly empty"]},
     {"label":"Tyres OK","field_type":"boolean","required":true},
     {"label":"Lights OK","field_type":"boolean","required":true},
     {"label":"Photo of any damage","field_type":"photo","required":false}]', 30);
