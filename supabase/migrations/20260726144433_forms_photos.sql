create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index form_templates_org_id_idx on public.form_templates(org_id);

create trigger form_templates_set_updated_at
  before update on public.form_templates
  for each row
  execute function public.set_updated_at();

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_template_id uuid not null references public.form_templates(id) on delete cascade,
  label text not null,
  field_type text not null check (field_type in ('text','number','photo','multiple_choice','boolean','date')),
  options jsonb,
  required boolean not null default false,
  sort_order int not null default 0
);

create index form_fields_template_id_idx on public.form_fields(form_template_id);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  taken_at timestamptz,
  uploaded_at timestamptz,
  lat double precision,
  lng double precision,
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index photos_visit_id_idx on public.photos(visit_id);
create index photos_org_rep_idx on public.photos(org_id, rep_id);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  form_template_id uuid not null references public.form_templates(id),
  rep_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index form_submissions_visit_id_idx on public.form_submissions(visit_id);
create index form_submissions_org_rep_idx on public.form_submissions(org_id, rep_id);

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  form_submission_id uuid not null references public.form_submissions(id) on delete cascade,
  form_field_id uuid not null references public.form_fields(id) on delete cascade,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  photo_id uuid references public.photos(id) on delete set null
);

create index form_responses_submission_id_idx on public.form_responses(form_submission_id);
