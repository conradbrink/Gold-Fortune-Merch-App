# Tickd sales site

The public website for Tickd, the multi-company field-teams platform built
on the Gold Fortune app. It is a separate Next.js app from `web/` (the product)
so that a copy change never redeploys the product.

```
npm install
npm run dev      # http://localhost:3100
```

## Where things live

| What | File |
|---|---|
| Name, domain, email, WhatsApp number, legal name | `lib/site.ts` (`site`) |
| Prices and add-ons | `lib/site.ts` (`pricing`) |
| All page copy | `app/page.tsx` |
| Brand colours and fonts | `app/globals.css` (`@theme`), `app/layout.tsx` |
| Logo | `components/logo.tsx`, `public/tickd-logo.svg`, `public/tickd-mark.svg`, `app/icon.svg` |

## Rules for the copy

- **Only claim features that are live in the product.** Planned features go in
  the "On the way" list, never in the feature grid. Before claiming a competitor
  lacks something, confirm it in their trial.
- **Don't name Gold Fortune** (or any customer) without their written OK.
- Prices include VAT; say so wherever a price appears.

## Brand

| Token | Value | Use |
|---|---|---|
| Teal 900 | `#0F3D3E` | primary: headings, dark sections, logo tile |
| Amber 500 | `#F5A524` | accent: main buttons, the check in the logo, highlights |
| Sand | `#F7F7F2` | page background |
| Display font | Outfit 700/800 | headings and the wordmark |
| Body font | Inter | everything else |

The mark is a double tick, "seen and done" (the WhatsApp read-receipt every
South African knows): a sand tick and an amber tick on a teal tile. On dark
backgrounds the tile turns sand and the first tick teal.

| File | Use |
|---|---|
| `public/tickd-logo.svg` | Mark + wordmark, for light backgrounds |
| `public/tickd-logo-inverse.svg` | Mark + wordmark, for dark backgrounds |
| `public/tickd-mark.svg`, `app/icon.svg` | Mark alone: favicon, app icon, social avatar |

The wordmark in the SVG files is outlined (Outfit ExtraBold converted to
paths), so the files look the same on machines without the font.

## Deploying (owner)

1. Buy `tickd.co.za` (and `tickd.co.bw` if wanted). Free on 7 Oct 2026; `tickd.com` is parked for resale at $49,850, so use `.co.za`.
2. In Vercel: **Add New → Project**, import this repo, set **Root Directory** to
   `site`. No environment variables are needed.
3. Add the domain to that project. Point `app.tickd.co.za` at the existing
   `web` project when the product moves to the new name.
4. Fill in `site.whatsapp` in `lib/site.ts` once the WhatsApp Business line
   exists; until then the buttons open an email.

## Before taking payments

The payment gateway (see `docs/PAYMENT-GATEWAYS.md`) will review this site. It
needs Terms of service, a Privacy policy (POPIA), a Refund and cancellation
policy and contact details live first. Those pages are not written yet; they
need a lawyer's wording, not generated text.
