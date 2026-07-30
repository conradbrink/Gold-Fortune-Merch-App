-- Android release manifest.
--
-- One row per published APK. Three separate consumers read it, which is why it
-- lives in the database rather than in a JSON file next to the build:
--
--   1. the public download page, for version, date, size and release notes
--   2. the APK download route, which resolves storage_path to a private object
--   3. the running app, which compares its own version_code against the current
--      row to decide whether to offer — or require — an update
--
-- Deliberately NOT org-scoped. There is one Android app, and a rep must be able
-- to check for an update before anyone knows which organisation they belong to.

create table if not exists public.app_releases (
  id                        uuid primary key default gen_random_uuid(),
  platform                  text        not null default 'android',

  -- What the user sees ("1.0.0") and what Android actually compares.
  -- version_code is the real identity of a release: Android refuses to install
  -- an APK whose code is lower than the installed one, so it must only ever
  -- increase. Unique, because two releases sharing a code is the one mistake
  -- that cannot be corrected by publishing again.
  version_name              text        not null,
  version_code              integer     not null,

  release_date              date        not null default current_date,

  -- Shown verbatim on the download page as "what changed". An array rather than
  -- prose so the page can render list items without parsing markdown.
  notes                     text[]      not null default '{}',

  -- Object key inside the private `app-releases` bucket. Never a public URL:
  -- the bytes are served through a route that streams them, so the bucket
  -- itself stays unlistable.
  storage_path              text        not null,
  file_size_bytes           bigint      not null,

  -- The forced-update floor. A client whose version_code is below this must
  -- update before it can keep working; at or above it, the update is optional
  -- and can be postponed. Defaults to 1 so that no existing install is locked
  -- out by simply publishing a release.
  min_supported_version_code integer    not null default 1,

  -- Exactly one row per platform is the live release. Enforced by the partial
  -- unique index below rather than by convention, because "which one is
  -- current?" answered two different ways is how a rep gets offered a
  -- downgrade.
  is_current                boolean     not null default false,

  created_at                timestamptz not null default now(),

  constraint app_releases_platform_check
    check (platform in ('android')),
  constraint app_releases_version_code_positive
    check (version_code > 0),
  constraint app_releases_min_supported_sane
    check (min_supported_version_code > 0
           and min_supported_version_code <= version_code),
  constraint app_releases_size_positive
    check (file_size_bytes > 0),
  constraint app_releases_version_name_shape
    check (version_name ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint app_releases_notes_bounded
    check (array_length(notes, 1) is null or array_length(notes, 1) <= 20)
);

create unique index if not exists app_releases_version_code_idx
  on public.app_releases (platform, version_code);

create unique index if not exists app_releases_one_current_idx
  on public.app_releases (platform) where is_current;

alter table public.app_releases enable row level security;

-- Readable by everyone, including anon.
--
-- The download page is public by design: a rep setting up a new phone has no
-- session yet, and cannot get one until the app they are trying to install is
-- installed. Nothing here is sensitive — it is a version number, a date, a byte
-- count and a changelog. The APK bytes are a separate matter and stay behind
-- the streaming route.
create policy app_releases_select_public on public.app_releases
  for select using (true);

-- No insert/update/delete policy exists on purpose. Publishing a release is a
-- deliberate operator action performed with the service role, documented in
-- docs/RELEASE-ANDROID.md. Leaving it out means no signed-in user — manager or
-- rep — can rewrite what the fleet is told to install.

comment on table public.app_releases is
  'Published Android releases. Drives the public download page and the in-app update check. Writes are service-role only; see docs/RELEASE-ANDROID.md.';

-- Private bucket for the APKs themselves.
--
-- 200 MB ceiling: a Flutter release APK is tens of megabytes, so this is
-- headroom rather than a target, and it stops an accidental upload of something
-- entirely different.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-releases', 'app-releases', false, 209715200,
  array['application/vnd.android.package-archive', 'application/octet-stream']
)
on conflict (id) do nothing;

-- No storage policy for anon or authenticated: nobody reads this bucket
-- directly. The download route reads it with the service role and streams the
-- bytes, so the bucket cannot be listed and old or draft APKs cannot be
-- fetched by guessing a path.
