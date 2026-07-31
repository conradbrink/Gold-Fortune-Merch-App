# Backup and restore

Honest summary: **the database is backed up automatically. Nothing else is.**
The gaps are listed rather than glossed over.

---

## What is covered

| Thing | Backed up? | How | Kept | Verified |
|---|---|---|---|---|
| **Database** (stores, visits, routes, forms, accounts) | ✅ Yes | Supabase Pro daily | 7 days | ✅ Backups exist and were seen |
| **Photos and documents** (Storage) | ❌ **No** | — | — | — |
| **Application code** | ✅ Yes | GitHub, plus every developer clone | Forever | ✅ |
| **Deployment configuration** | ⚠️ Partly | `vercel.json`/CI in git; env var *values* only in Vercel | — | — |
| **Android signing key** | ⚠️ Owner-held | `~/gf-merch-release.jks` + password manager | — | ⚠️ Restore never tested |
| **Database structure and policies** | ✅ Yes | 71 migration files in git | Forever | ✅ Verified matching production |

---

## 1. Database — automatic

**Supabase Pro, daily, around midnight in the project's region (eu-west-3,
Paris). Retained 7 days.**

**To confirm it is working** — do this monthly, it takes 30 seconds:

Supabase → **Database → Backups → Scheduled backups**. There should be one
entry per day, newest less than ~48 hours old.

*Verified 30 July 2026: five daily backups present (26–30 July).*

**Who has access:** anyone with access to the Supabase organisation `Cons Org`.
Today that is the owner's account. Restoring is not something a rep or manager
of the app can do — it is a hosting-account action.

### To restore

⚠️ **A restore replaces the entire database with its state at that moment.
Everything recorded since is lost** — every visit, check-in, form and photo
reference. For a working field team that can be a day's work.

**Never restore without the owner's explicit approval.** Read section 5 of
`ROLLBACK_PROCEDURE.md` first — a targeted fix is nearly always better.

1. Supabase → Database → Backups
2. Choose the backup **immediately before** the problem
3. **Restore**, and confirm
4. The project is briefly unavailable — reps cannot sign in during this
5. Afterwards: re-run the security suite, and check counts
   (`select count(*) from public.stores;` should be 209)

### ⚠️ Restore has never been tested

We have not performed a restore. The backups demonstrably **exist**; that they
restore *correctly* is untested, and this document will not claim otherwise.

**To test it safely** — restore into a *separate* project, never over
production. Supabase → Backups → **"Restore to new project"**. That creates a
new project, which **costs money**, so it needs approval first.

---

## 2. Photos and documents — NOT backed up

**This is the real gap.** Supabase states it plainly on the Backups page:

> Database backups do not include objects stored via the Storage API.

So `visit-photos` (evidence a rep was at a store), `files` (shared documents)
and `app-releases` (the APK) are **not** covered.

Consequences:

- The **APK is fine** — reproducible from the tagged source plus the keystore.
- **Shared documents** are presumably held elsewhere too.
- **Visit photos are not reproducible.** If lost, they are gone.

As at **31 July 2026** there were 0 visit photos, so nothing was at risk then.
That changes the moment reps start working. Check the current number rather than
trusting this sentence:

```sql
select count(*) as photo_files
from storage.objects where bucket_id = 'visit-photos';
```

**Options, none yet implemented:**

1. A scheduled export of the bucket to storage you control
2. Accept that photos are transient and the database record is what counts —
   a legitimate decision, but it should be a decision
3. Supabase Storage's own replication features, if the plan offers them

**Decision required from the owner.** Doing nothing is a choice too, and it
should be a knowing one.

---

## 3. Code — GitHub

Every commit, branch and tag. Additionally cloned on every developer machine,
so GitHub disappearing is survivable.

**Restore:** `git clone`, or `git checkout v1.0.0` for a specific release.

**The v1.0.0 tag is the marker for what was first live.**

---

## 4. Configuration

- **In git:** CI workflow, `vercel.json` if present, all migrations,
  `web/.env.example` (names, no values)
- **Not in git, by design:** the *values* of environment variables. They live
  in Vercel and in `web/.env.local` on the developer machine

⚠️ **If both Vercel and that laptop were lost, the secret values would be
gone.** They are recoverable — each can be regenerated from the service that
issued it (Supabase, Google Cloud, OpenAI) — but it is a rebuild, not a
restore. Keeping a copy in your password manager would remove that.

---

## 5. Android signing key — the irreplaceable one

`~/gf-merch-release.jks`, password in the owner's password manager.

**This cannot be regenerated.** Lose it and the app can never be updated again;
the only route is a new package ID and a manual reinstall by every rep.

**Required, and the owner's responsibility:**

- [ ] The `.jks` file stored somewhere other than the laptop, encrypted
- [ ] The password in the password manager, with the alias `gf-merch` noted
- [ ] The two stored so that losing one does not lose both
- [ ] **The backup tested** by restoring it elsewhere and running:
      `keytool -list -keystore <restored.jks>`

An untested backup of this file is a hope, not a backup.

Certificate fingerprint, so a future build can be checked against it:
`0b68016543e7fed5ed0433bf8e1c2ed50fdac2be66a96e3b40b4a45305b1f394`

---

## Summary of what still needs doing

| Gap | Who | Urgency |
|---|---|---|
| Photo backup — decide and implement | Owner decides | Before reps generate many photos |
| Test a database restore (needs a temporary paid project) | Needs approval | Before you need it for real |
| Verify the keystore backup restores | Owner | Now — it is irreplaceable |
| Copy env var values into the password manager | Owner | Low, they are regenerable |
