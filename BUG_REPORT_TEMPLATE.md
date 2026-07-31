# Bug report template

Copy this, fill in what you can, and send it. **A partial report is much better
than no report** — but the four starred fields are the ones that usually decide
whether a bug can be found at all.

The same template appears automatically when you open an issue on GitHub.

---

```markdown
## Title
<!-- One line. "Photos don't upload after being offline" beats "app broken". -->


## Who it happened to
<!-- Name or role. Which rep, or which manager. -->


## When
<!-- Date and roughly what time. "Tuesday around 10am" is fine.
     Time matters — it lets us find the exact request in the logs. -->


## ⭐ Which app, and which version
<!-- Phone app: the version is on the download page, e.g. 1.0.0
     Website: just say "website" and roughly when. -->

- App: phone / website
- Version:

## Device
<!-- Phone app: make, model, Android version (Settings → About phone).
     Website: which browser. -->

- Device:
- Android version:
- Browser (website only):

## ⭐ What you expected to happen


## ⭐ What actually happened


## ⭐ Steps to make it happen again
1.
2.
3.

## Does it happen every time?
<!-- every time / sometimes / only once -->


## Screenshot or recording
<!-- Drag it in. A 10-second recording is worth a page of description. -->


## Was any information lost or changed?
<!-- Did a visit disappear? Did a photo not save? Did something show the wrong
     number? This decides how urgently we treat it. -->


## How bad is it?
<!-- Delete the two that do not apply -->

- **Critical** — nobody can work, or data is being lost
- **Major** — an important feature is broken, but there is a way around it
- **Minor** — annoying, cosmetic, or rare

## Anything else
<!-- Were you offline? Had you just updated? Was it only at one store? -->
```

---

## What each severity means in practice

| | Meaning | Response |
|---|---|---|
| **Critical** | Reps cannot work, or data is being lost | Looked at immediately, out of hours if needed |
| **Major** | An important feature is broken but has a workaround | Next working day, fixed that week |
| **Minor** | Cosmetic, or rare | Batched into the next release |

**If you are unsure, call it Critical.** It is far cheaper to downgrade a
report than to discover a week later that visits were quietly not saving.

## Two things that make a bug much easier to fix

**The version.** Behaviour differs between releases, and reps update at
different times. Two people on different versions can genuinely see different
things.

**Whether it is repeatable.** A bug that happens every time is usually found in
minutes. One that happened once may need the logs, and the time it happened is
then the only way in.

## Offline bugs

Say explicitly:

- Were you offline when it happened, or when you noticed?
- Did the app say the work was saved?
- Had it synced before the problem appeared?

Offline and sync bugs are the hardest class in this system, and that sequence
is usually the whole diagnosis.
