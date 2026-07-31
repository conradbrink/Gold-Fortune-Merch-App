# Rollback procedure

For when a release has made things worse.

## First: stop and ask one question

> **Did this release change the database?**

Check the merged pull request for files under `supabase/migrations/`.

- **No** → rolling the code back is safe. Go to section 2.
- **Yes** → **read section 5 before doing anything.** Rolling code back while
  leaving the database changed puts old code in front of a new schema, and that
  usually causes worse problems than the bug you are escaping.

## 1. Find the last stable release

```bash
gh release list
git tag -l
```

The most recent tag before the bad one is your target. Each release body
records the commit it points at.

```bash
git log --oneline v1.0.0..main    # what has landed since that release
```

## 2. Roll the website back — seconds, no rebuild

Vercel keeps every previous deployment built and ready.

1. **Vercel → the project (`app`) → Deployments**
2. Find the last deployment known good — match the commit SHA to the tag
3. **⋯ → Promote to Production**

Live again in seconds, because that build was never deleted.

**Verify:** `/login` loads, sign-in works, `/download` loads signed-out.

## 3. Then fix the branch — do not skip this

Promoting an old deployment does **not** change `main`. The bad code is still
there, and the next unrelated merge will redeploy it on top of your rollback.

```bash
gh pr list --state merged --limit 5      # find the bad PR number
gh pr revert <number>                     # opens a revert PR
```

Or by hand:

```bash
git checkout -b fix/revert-<thing> main
git revert -m 1 <merge-commit-sha>
git push -u origin fix/revert-<thing>
```

Then merge that revert PR through the normal process. Reverting is preferred
over force-pushing: it keeps the history honest about what happened, and
force-pushing `main` is blocked anyway.

## 4. A bad Android release

**You cannot pull an APK back off a rep's phone**, and Android refuses to
install an older `versionCode` over a newer one. So:

**For people who have not yet updated** — make the previous release current:

```sql
begin;
update public.app_releases set is_current = false where platform = 'android';
update public.app_releases set is_current = true
 where platform = 'android' and version_code = <previous code>;
commit;
```

The download page immediately serves the older APK again.

**For people who already updated** — the only route is forward. Fix the bug,
raise `versionCode`, publish. If the broken version is genuinely unusable, set
`min_supported_version_code` on the new release to force everyone onto it.

⚠️ **Forcing an update stops reps working until they have signal and 40 MB.**
Anything saved on their phone survives, and the screen says so — but the visit
they are standing in front of still stops. Use it for data corruption or a
security hole, not for cosmetic bugs.

## 5. If the database was changed

**Do not reflexively restore the database.** A restore loses every visit,
photo, form and check-in recorded since the backup. For a field team that can
be a whole day's work across three reps.

Work through it in this order:

**a. Establish whether production data is actually affected.**

```sql
-- Anything created or changed since the release went out?
select count(*) from public.visits  where created_at > '<release time>';
select count(*) from public.visits  where updated_at > '<release time>';
select count(*) from public.workday_sessions where created_at > '<release time>';
```

Also check the audit log:

```sql
select * from public.security_events
 where created_at > '<release time>' order by created_at desc;
```

**b. If the schema changed but data is intact** — the usual case. Write a new
migration that undoes the structural change. Do **not** delete the original
migration; it has run, and editing history is what caused the drift this
process exists to prevent.

**c. If data is wrong but not lost** — fix it with a targeted, reviewed
migration or script. Far less destructive than a full restore.

**d. If data is genuinely lost** — only then consider a restore, and only with
the owner's explicit approval. See `BACKUP_AND_RESTORE_PROCEDURE.md`.

⚠️ **Restoring the database does not restore photos.** Supabase backups exclude
Storage. A restore brings back the database rows that *reference* photos, while
the photo files stay as they are now.

## 6. Afterwards

- [ ] Confirm production is healthy — the smoke test in `RELEASE_CHECKLIST.md`
- [ ] Confirm a rep can complete a real check-in
- [ ] Write down what happened and what was actually wrong
- [ ] Add a test that would have caught it
- [ ] Only then re-attempt the change

---

## Practising this

**The website rollback should be rehearsed on staging before it is needed**,
not learned during an incident. Promote an older deployment, confirm the site
serves the older version, promote the current one back.

Do **not** rehearse on production. A rollback is only performed there when
there is a real problem and the owner has approved it.

**Status: not yet rehearsed** — staging does not exist. Once it does, this is
the first thing to practise.
