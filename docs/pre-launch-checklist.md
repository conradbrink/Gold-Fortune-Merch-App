# Pre-launch checklist

Things that are fine to defer during development but should be revisited
before real merchandisers/managers start using this app.

## Supabase / Auth

- [ ] **Enable leaked-password protection.** Currently disabled — it's a
      Pro-plan feature and the project (`rxtlnetlzmbqirqaalkw`, org "Cons
      Org") is on the Free plan. Once upgraded, enable it at
      Dashboard → Authentication → Providers → Email → "Prevent use of
      leaked passwords" (or
      `https://supabase.com/dashboard/project/rxtlnetlzmbqirqaalkw/auth/providers?provider=Email`).
      In the meantime, the Free-plan-available settings on that same page
      (minimum password length 8+, required character classes) are already
      a reasonable partial mitigation and cost nothing to enable now.
- [ ] **Rotate/remove the seeded dev accounts** (`manager@goldfortune.dev`,
      `rep@goldfortune.dev`, and the ~10 other seeded rep accounts) before
      onboarding real users — they all share a known password
      (`GoldFortune2026!`) used only for development.
- [ ] **Wire up "Invite team member"** on the Company Profile → Team
      Members tab. It currently just shows an explanatory note — real
      invites need a server-side flow using the Supabase service-role key
      (e.g. a Supabase Edge Function), which intentionally hasn't been
      added yet since that key must never be embedded in client code.

## Billing

- [ ] Company Profile → Plan & Billing is illustrative only — no payment
      provider (e.g. Stripe) is integrated yet. Plan cards and seat/place
      usage are real counts, but "Switch plan" and "Manage billing" are
      not wired to anything.

## Reports

- [ ] The Reports page still shows placeholder/mock data. Real report
      content depends on reps actually submitting forms from the mobile
      app, which is still in progress — see the main build plan for
      status.
