# Payment gateway recommendation: field teams SaaS (ZA seller, ZA and Botswana B2B customers)

Research date: **7 October 2026**. All research was read-only. I did not sign up for anything, submit any form, or contact any provider.

> **Update, 7 Oct 2026:** Tickd's prices *include* VAT (owner's decision after this research), so the base charge is R1,499, not the R1,723.85 used in the worked examples below. The fee percentages are unaffected.

Fee figures are **excluding VAT** unless stated. Each figure says where I read it. "Official" means the provider's own site or docs, read on 7 Oct 2026. "Third-party" means a blog or aggregator and is less reliable.

---

## 1. TL;DR

| | |
|---|---|
| **Primary** | **Paystack (South Africa)**, a Stripe company. Save the customer's card once, then charge it through `POST /transaction/charge_authorization` with whatever amount we calculate each month. We run the billing schedule ourselves (Supabase cron or an edge function), so pro-rating, add-ons and user-count changes are just numbers we compute. |
| **Card backup** | **Payfast by Network.** Its tokenization ("ad hoc") flow works the same way: one saved card, then `POST /subscriptions/:token/adhoc` with any amount in cents. It can save a card at R0.00 with 3-D Secure (3DS). Fees are higher and the API is older in style, but it is the most established SA option. Keep it as a documented fallback rather than building it on day one. |
| **Optional debit orders (SA customers only)** | **Netcash.** It offers DebiCheck, Registered Mandate debit orders and credit-card debit orders, with batch and API upload. Pricing is quote-only. Add it only if SA customers ask for debit orders. Debit orders cannot collect from Botswana bank accounts. |
| **Botswana** | Botswana-issued Visa and Mastercard cards count as **international cards** for SA gateways. Paystack, Payfast, Peach, Ozow and Stitch Express all say they accept international Visa/Mastercard, charged in **ZAR**. The customer's bank does the FX and may add a foreign-transaction fee. **None of the SA gateways settle in BWP.** For BWP pricing and BWP settlement, the realistic route is **DPO Pay by Network** (it has a Botswana presence), which most likely needs a Botswana-registered entity and bank account. |
| **Not recommended** | Stripe: not available directly to SA businesses, it routes them to Paystack. Yoco: no recurring billing. Ozow: pay-by-bank first, no native card-on-file billing. Stitch: the recurring product is enterprise sales-led, and the SMB product (Stitch Express) is plugin-only. Peach: viable, but recurring is billed at the higher 3.50% + R1.50 rate. PayGate: needs your own merchant account and is now part of Payfast. Paddle and Lemon Squeezy: viable on paper but cost 5% + 50c, and *they* invoice the customer, which conflicts with "we issue our own VAT invoice". |

---

## 2. Comparison table

What one charge costs. Example: base plan R1,499 + 15% VAT = **R1,723.85** charged to the card. Calculated from the official rates below (ex VAT).

| Provider | Variable-amount saved-card charges? | Provider-managed plans? | Debit order | Local card fee | Intl card fee | Fee on R1,723.85 (ex VAT) | Monthly / setup | Payout | Botswana cards | BWP settlement | API / DX |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Paystack ZA** | **Yes.** `charge_authorization` takes any amount | Yes (Plans/Subscriptions, fixed amount per plan, no retries) | No (direct debit is Nigeria only) | 2.9% + R1 | 3.1% + R1 (pricing page) | R50.99 (local) / R54.44 (intl) | None | Free payouts, T+2 working days | Yes, once international payments are enabled | No (ZAR only) | REST/JSON, HMAC-SHA512 webhooks, test mode, official `@paystack/paystack-sdk` (v1.2.1, Aug 2026) |
| **Payfast by Network** | **Yes.** Tokenization + `POST /subscriptions/:token/adhoc` | Yes (subscriptions: fixed amount, Payfast retries) | No | 3.2% + R2 | Same rate, intl Visa/MC accepted | R57.16 | None | 48–72 h hold, then about 2 working days. R8.70 per payout, or 0.8% (min R14) for immediate payout | Yes, per FAQ "from anywhere in the world" | No (ZAR only) | Form-post checkout + REST-ish API with MD5 signature headers, ITN callbacks, sandbox. No official Node SDK |
| **Peach Payments** (Growth plan) | **Yes.** `standingInstruction` MIT, `/v1/registrations/{id}/payments` | Dashboard "Recurring" product | No | 2.95% + R1.50 (3DS) | 3.50% + R1.50 | **R61.83** (recurring/non-3DS rate is 3.50% + R1.50) | None on Growth plan | Next business day | Yes, "any credit or debit card issued anywhere" | No (ZAR) | OPPWA REST (form-encoded), sandbox, webhooks. No official Node SDK found |
| **Stitch** (enterprise) | Yes (card tokenisation + Collections via GraphQL) | n/a | **Yes, DebiCheck**, plus Capitec Pay VRP | Quote | Quote | n/a | Quote | Quote | n/a | No | GraphQL, enterprise sales-led |
| **Stitch Express** (SMB, ex-WigWag) | Not exposed for custom apps (Shopify subscriptions only) | Shopify only | No | 2.95% | 3.4% | n/a | None | 1–2 business days, R2.30 incl VAT per withdrawal | Yes, charged in ZAR | No | Plugins and payment links only |
| **Yoco** online | **No.** "doesn't currently support subscriptions or recurring billing" | No | No | 2.55–2.95% | not stated | n/a | None | Up to 2 business days | Yes (intl cards) | No | Checkout API |
| **Ozow** | No native card-on-file billing (Revio partnership) | No | No | 2.85% (card) / 1.5% pay-by-bank | 3.5% | n/a | None | Next day | Cards: intl 3.5%. Pay-by-bank: SA banks only | No | REST |
| **Netcash** | Credit-card debit orders (batch) | Via its billing tools | **Yes: DebiCheck, Registered Mandate, 2-day and same-day** | Quote | Quote | n/a | Quote | 2 days (delayed settlement) | Not for debit orders | No | Batch file + web services. Dated, SOAP-style (not verified in detail) |
| **DPO Pay by Network** | Yes (Super Wallet `chargeTokenRecurrent`, needs a new `createToken` per charge, so the amount can vary). Activated on request | "Recurring" on request | No | Quote (third-party: about 3% in BW) | Quote (third-party: 3.5–5%) | n/a | No setup fee (official). Monthly fee: third-party says P200–P300 | Quote. Rolling reserve, typically 180 days | Yes | **Yes, likely with a BW entity** (unverified) | XML API (v6/v7), sandbox, callbacks |
| **PayGate** (now part of Payfast) | Yes (PayHost + PayVault token payments) | PayHost | No | Needs your own merchant account (bank rates) | — | n/a | Bank and gateway fees, quote | Bank | Yes | No | SOAP-ish PayHost |
| **Stripe** | — | — | — | **Not available to SA businesses.** stripe.com/global lists South Africa as "Extended network" and links to Paystack | | | | | | | |
| **Paddle** (merchant of record) | Paddle-managed subscriptions (proration supported) | Yes | No | 5% + 50c all-in | same | about R86 + 50c | None | ZAR payout supported (not a balance currency) | Yes (charge in ZAR or USD) | **No BWP** | Excellent REST, webhooks, sandbox, Node SDK. **Paddle is the seller and issues the invoice** |
| **Lemon Squeezy** | LS-managed subscriptions | Yes | No | 5% + 50c (+ intl extras) | | | None | Bank or PayPal, twice monthly | Yes | No | Being migrated to Stripe Managed Payments (third-party: about 6.4% + 30c) |

---

## 3. Per-provider notes (with sources)

### 3.1 Paystack (South Africa): recommended primary

- **Status.** Owned by Stripe ("Paystack is a Stripe company", site footer). Reorganised under a holding company, **The Stack Group**, in Jan 2026 ([Semafor, 20 Jan 2026](https://www.semafor.com/article/01/20/2026/paystack-eyes-growth-beyond-payments-with-restructuring), third-party news). Stripe's own country page sends SA businesses to Paystack ([stripe.com/global](https://stripe.com/global), read 7 Oct 2026).
- **Recurring.** [Recurring Charges docs](https://paystack.com/docs/payments/recurring-charges/), read 7 Oct 2026:
  - After the first successful card payment you store the `authorization` object. Charge it later with `POST https://api.paystack.co/transaction/charge_authorization` passing `authorization_code`, `email` and **any `amount`**. You run the billing cron.
  - Only use authorizations where `reusable: true`. Store the email used, because only that email can charge the authorization. Store `country_code`, which tells you which country issued the card (useful to flag Botswana cards).
  - The recommended minimum first charge to save a card is **ZAR 1.00**. For us, the first real invoice at trial conversion is the card-saving payment.
  - The extra 2FA challenge on saved-card charges is "by default ... available to betting merchants with a Nigerian integration". There is no indication that SA charges are challenged.
- **Subscriptions API (optional, not recommended for us).** [Subscriptions docs](https://paystack.com/docs/payments/subscriptions/), 7 Oct 2026:
  - Plans have a fixed amount. Changing the price is done with Update Plan (`update_existing_subscriptions`), which changes it for everyone on that plan.
  - **"Subscriptions aren't retried"**: a failed subscription charge is not attempted again.
  - Webhooks: `invoice.create` (3 days before), `invoice.payment_failed`, `subscription.expiring_cards`, and so on. There is a hosted "manage subscription / update card" link.
  - A plan per customer would be clumsy for per-seat pricing, so use `charge_authorization` instead.
- **Fees.** [paystack.com/za/pricing](https://paystack.com/za/pricing?localeUpdate=true), read 7 Oct 2026:
  - Local: **2.9% + ZAR 1** ex VAT (the ZAR 1 is waived under ZAR 10). Capitec Pay and Ozow EFT: 2%, no flat fee.
  - International: **3.1% + ZAR 1** ex VAT, "charged and settled in Rand".
  - "No upfront or monthly fees. All payouts are free." Transfers to bank accounts: ZAR 3 each.
  - ⚠️ The [international payments support article](https://support.paystack.com/en/articles/2130690) (7 Oct 2026) lists SA international as "2.9% + R1.00". It conflicts with the pricing page. Budget for 3.1%.
  - Paystack charges 15% VAT on its fee and provides a downloadable tax invoice for input VAT ([SA compliance article](https://support.paystack.com/en/articles/2124418)).
- **Payout.** "2 working days after a customer pays" (pricing FAQ, 7 Oct 2026).
- **Botswana.**
  - Paystack accepts Visa/Mastercard/Verve (and Amex for ZA businesses) from anywhere **once international payments are enabled**. You ask for it at signup or later in Dashboard → Preferences, with a response "within 48 working hours" ([support 2130690](https://support.paystack.com/en/articles/2130690)).
  - SA businesses can only receive **ZAR**. Paystack does not operate in Botswana: its pricing page lists Côte d'Ivoire, Ghana, Kenya, Nigeria and South Africa only (Egypt and Rwanda are also mentioned elsewhere), and I found no Botswana launch.
- **Onboarding.** [SA compliance requirements](https://support.paystack.com/en/articles/2124418) and [business types](https://support.paystack.com/en/articles/2128898), 7 Oct 2026:
  - *Sole proprietorship (Starter):* personal or business bank account, bank confirmation letter (6 months old at most), owner contact details, valid ID, proof of address (6 months old at most). **Collection limit ZAR 1,000,000.** No Transfers feature (not needed).
  - *Registered business:* bank confirmation letter for the company account (6 months old at most), CIPC certificate, CIPC enterprise number, at least one director's details. No limit.
  - Every name has to match across the documents.
- **DX.** REST/JSON with Bearer secret key. Separate test and live keys. Webhooks are signed with `x-paystack-signature` (HMAC-SHA512 of the body with your secret key). In live mode they are retried every 3 minutes for 4 tries, then hourly for 72 h ([webhooks docs](https://paystack.com/docs/payments/webhooks/)). There is an official npm package `@paystack/paystack-sdk` (maintainers @paystack.com, v1.2.1 published 24 Aug 2026, checked on the npm registry), plus Paystack CLI and Slack community. A plain `fetch` wrapper is also trivial on Supabase edge functions or Vercel.
- **Notable.** We own dunning: retry schedule, emails, suspension. The auto-retry we lose is only in the subscriptions product, which doesn't retry anyway. Chargeback alerts are in the dashboard.

### 3.2 Payfast by Network: recommended backup

- **Status.** Network International bought Payfast in 2021 and the company rebranded as Network. The product is still "Payfast by Network" at payfast.io ([Payfast blog](https://payfast.io/blog/payfast-is-now-network/)). PayGate and SiD were merged under it in 2023 ([blog, 25 May 2023](https://payfast.io/blog/payfast-rebrand-brings-paygate-and-sid-under-one-roof/)). It is SARB-designated as a clearing system participant ([blog](https://payfast.io/blog/payfast-by-network-receives-sarb-designation/)).
- **Recurring.** [Developer docs, Recurring Billing](https://developers.payfast.co.za/docs#recurring_billing) and [API ref](https://developers.payfast.co.za/api#recurring-billing), read 7 Oct 2026:
  - Two modes. **Subscriptions** (`subscription_type=1`) have a fixed amount, a frequency and cycles. Payfast retries a failed payment "a number of times", then "locks" the subscription. The amount can be changed with `PATCH /subscriptions/:token/update`.
  - **Tokenization** (`subscription_type=2`) is "a recurring charge where the future dates and amounts of payments may be unknown". Payfast only charges when told to via `POST /subscriptions/:token/adhoc` with `amount` in cents. It can be set up with an **initial amount of R0.00**: the customer enters the card and goes through 3DS, and no money is taken.
  - "For Recurring Billing only the credit card option can be used." Marketing pages say "credit or cheque card". Whether pure debit cards work is unclear.
  - There is a hosted "update card" link at `/eng/recurring/update/{token}`. A passphrase is required. There are webhooks for trial end and amount increase.
- **Fees.** [payfast.io/fees](https://payfast.io/fees/), read 7 Oct 2026:
  - Card **3.2% + R2.00**. Instant EFT and Capitec Pay 2.0% (min R2).
  - **Payout R8.70 ex VAT** per payout. Immediate Payout 0.8% (min R14). Refund R2.00.
  - No setup or monthly fee shown. Custom pricing above R50k/month average.
  - No separate recurring or tokenization fee is listed.
- **Payout.** A 48–72 h holding period, then about 2 working days ([KB: collection and payout process](https://support.payfast.help/portal/en/kb/articles/collection-and-payout-process-20-9-2022)). Payouts can be automatic daily, weekly or monthly.
- **Botswana.** The fees-page FAQ says: "receive international payments made via Visa and Mastercard credit cards from anywhere in the world". You don't need to be an SA resident, but **you must have an SA bank account**. ZAR only. One third-party page claims Payfast only accepts SA-issued cards; that contradicts the official FAQ and I treat it as wrong.
- **Onboarding.** [Payfast KYC blog, 26 Mar 2026](https://payfast.io/?p=29694):
  - Individual or sole prop: SA ID or passport, proof of address (3 months old at most), bank confirmation letter or statement.
  - Pty Ltd: CIPC documents, proof of business address, bank confirmation, IDs of all directors, beneficial ownership details.
  - About 2 business days to verify. Card acceptance needs a verified account.
- **DX.** Form-POST redirect or onsite modal. ITN callback (server-to-server POST that you validate by signature plus server confirmation). The API uses `merchant-id`, `version`, `timestamp` and an MD5 `signature` header. There is a sandbox at sandbox.payfast.co.za. I found no official Node SDK; the npm `payfast` package is a 2022 community React Native wrapper. Workable, but older in style.

### 3.3 Peach Payments

- **Fees.** [peachpayments.com/fees?country=za](https://www.peachpayments.com/fees/?country=za), read 7 Oct 2026, Growth plan:
  - Local cards (3DS) **2.95% + R1.50**. International **3.50% + R1.50**.
  - **"Local ... (non-3dsecure) / Recurring 3.50% + R1.50"**, so saved-card charges cost more.
  - Pay by Bank and Capitec Pay 1.50% + R1.50.
  - No setup or monthly fee on the Growth plan. Enterprise plan is negotiable.
- **Recurring.** [Card-on-file guide](https://developer.peachpayments.com/docs/oppwa-guides-card-on-file):
  - The first payment is customer-initiated (CIT) with `standingInstruction.mode=INITIAL`, 3DS and CVV, and `createRegistration=true` to save the card.
  - Later charges are merchant-initiated (MIT) with `mode=REPEATED, source=MIT` and the `initialTransactionId`, with no CVV or 3DS, via `/v1/registrations/{id}/payments`. Types are UNSCHEDULED, RECURRING and INSTALLMENT, so a variable amount is possible.
  - Sandbox: `sandbox-card.peachpayments.com`. Recurring must be configured (a "recurring ID and access token") ([dashboard recurring](https://developer.peachpayments.com/docs/dashboard-recurring)).
- **Payout.** Next business day (fees FAQ).
- **Botswana.** "any credit or debit card issued anywhere in the world to be accepted", settled in ZAR. Peach operates in ZA, Kenya and Mauritius. A case study mentions "multi-currency support—handling transactions in local currencies like Pula" ([iTickets, 15 Jun 2025](https://www.peachpayments.com/scale/itickets-x-peach-payments-point-of-sale/)), but no BWP settlement offer for an SA merchant is documented.
- **Onboarding.** Sole props and registered businesses are accepted. Sole prop: ID, proof of business address (3 months old at most), proof of bank account ([FICA requirements](https://support.peachpayments.com/support/solutions/articles/47001250808-merchant-fica-requirements); summarised from search results).
- **Verdict.** Technically good. It costs about 0.6 percentage points more than Paystack on every monthly charge because recurring is billed at 3.50% + R1.50.

### 3.4 Stitch / Stitch Express

- **Stitch (enterprise).**
  - Supports "every mandated recurring payment method in South Africa, including DebiCheck", plus card tokenisation, Capitec Pay VRP (launched with Capitec, [TechCabal, 4 Dec 2025](https://techcabal.com/2025/12/04/capitec-vrp-lets-south-africans-make-recurring-payments-directly-from-bank/)), and automated fallback between methods ([stitch.money/solutions/recurring-payments](https://stitch.money/solutions/recurring-payments)).
  - Positioned for "large-scale businesses". Pricing is via Contact Sales ([support](https://support.stitch.money/hc/en-us/articles/5061103787537-Where-can-I-find-Stitch-pricing-information)).
  - The API is GraphQL (`api.stitch.money/graphql`), with a `DebiCheckMandate` object and card Collections ([docs](https://docs.stitch.money/payment-products/payins/card/tokenization/collections/)).
  - Raised $55M Series B in Apr 2025 and bought ExiPay in Jan 2025 (third-party news).
- **Stitch Express** is the former WigWag, aimed at SMBs.
  - Fees: card **2.95%** local / **3.4%** international. Withdrawals R2.30 incl VAT (1–2 days) or R11.50 incl VAT (instant). Custom rates above R200k/month ([support article](https://support.express.stitch.money/hc/en-us/articles/48136247509009-What-processing-fees-do-I-pay), read 7 Oct 2026).
  - International cards are processed in ZAR ([article](https://support.express.stitch.money/hc/en-us/articles/47563117429521-International-payments-with-Stitch-Express)).
  - Integrations are Shopify, Woo, Squarespace, Webflow and payment links. **I found no public API for custom saved-card recurring billing.**
- **Verdict.** It is the strongest DebiCheck option, but it is sales-led and enterprise-focused. Worth a call later if debit orders become the main collection method.

### 3.5 Yoco (online)

- Fees "2.55 – 2.95%" ex VAT, no monthly fee ([yoco.com/za/online-payment](https://www.yoco.com/za/online-payment/), 7 Oct 2026). Online payouts take "up to two business days".
- **"Yoco Gateway doesn't currently support subscriptions or recurring billing."** ([Yoco support FAQ](https://support.yoco.help/en/articles/109553-yoco-online-payment-gateway-faqs), 7 Oct 2026). **Ruled out.**

### 3.6 Ozow

- [ozow.com/pricing](https://ozow.com/pricing), 7 Oct 2026, Standard package (no setup or monthly fee, next-day settlement):
  - Local cards 2.85% (min R1) for R0–R249,999.99 per month, 2.75% to R499,999.99, 2.65% to R1m. International cards 3.5%.
  - Capitec Pay, Pay by Bank and PayShap Request 1.5%.
  - Payouts R3, refunds R3.
- Recurring is via a partnership with Revio and "Ozow PIN"; there is no documented saved-card API for merchant-set amounts. Pay-by-bank works for SA banks only. **Not suitable as the billing engine.** It is useful as a one-off EFT option, which Paystack already includes ("Ozow EFT" at 2%).

### 3.7 Netcash: optional debit-order provider

- Offers 2-day and same-day debit orders, credit-card debit orders, eMandates, **DebiCheck** (activated by account support), unpaid recovery links, and up to 90% advance on collection day ([services page](https://netcash.co.za/services/debit-order-collections/); [help: debit order profile](https://help.netcash.co.za/docs/account-profile-2/service-profiles/debit-orders/); [DebiCheck blog, ~Mar 2023](https://netcash.co.za/blogs/debicheck-debit-orders/)).
- **Registered Mandate** replaced RMS on 12 May 2025. It suits "smaller or lower-risk recurring payments (subscriptions, memberships)" without bank authentication, but with moderate dispute risk ([Netcash blog, 5 Dec 2025](https://netcash.co.za/blog/debicheck-vs-registered-mandate-what-sa-businesses-should-know/)).
- **Fees are not published.** The help page lists fee *types* (module fee, two-day, same-day, unpaid, eMandate, DebiCheck TT1/TT2, disputes) without amounts. The only figures I found are old **Sage Pay-era (Netcash's former brand) numbers via a search-result summary: R190/month, R7.45 per successful debit, R3.60 per unpaid, R11.70 per dispute.** Third-party and probably outdated; get a quote.
- Settlement is 2 days on delayed settlement. Botswana bank accounts cannot be debited, because SA debit orders run only over SA clearing.

### 3.8 DPO Pay by Network: Botswana option

- DPO is part of Network International. The rebrand to "Network" is "rolling out across Uganda, Botswana, Namibia, Zambia and Kenya", and merchants keep using DPO Pay ([DPO blog](https://dpogroup.com/blog/dpo-pay-rebrand-2026/)). Network has offices including Botswana. "Network no longer charges set up fees" ([DPO FAQ](https://dpogroup.com/faq/), 7 Oct 2026).
- The FAQ mentions a **rolling reserve** "typically released after 180 days". It also lists KYC documents: certificate of incorporation, tax registration, directors' IDs, refund policy, logo, product list. Accounts are "live within 24hrs" after KYC.
- Recurring: **Super Wallet** tokenisation. `createToken` with `<AllowRecurrent>1</AllowRecurrent>`, then `getSubscriptionToken`, then a new `createToken` (which sets the amount) plus `chargeTokenRecurrent` ([tokenisation guide, updated 26 Mar 2026](https://docs.dpopay.com/dpo-pay-by-network/reference/recurring-payments-tokenisation-guide)). "Recurring and bulk payment options are available on request" ([docs](https://docs.dpopay.com/dpo-pay-by-network/docs/recurring-bulk-payments)). The API is **XML** (v6/v7) and there is a sandbox.
- Botswana fees (third-party, [payatlas](https://payatlas.com/countries/botswana-bw) and search summaries): about 3% local cards, 3.5–5% international, and **P200–P300/month** gateway fee. Unverified. The payatlas page also makes doubtful claims about Botswana capital controls (Botswana abolished exchange controls in 1999), so treat it with caution.
- **Use it only if** a Botswana customer must be invoiced and paid in BWP, or the owner sets up a Botswana entity.

### 3.9 PayGate

- Now part of Payfast by Network as the "Paygate Gateway", for "merchants with existing internet merchant accounts" (fees page, 7 Oct 2026). PayHost and PayVault support token payments ([docs.paygate.co.za](https://docs.paygate.co.za/paygate-by-network/reference/token-payment-host-to-host)).
- It historically served FNB Botswana and Stanbic Botswana merchants ([weblogic.co.bw, updated 10 Jun 2025](https://weblogic.co.bw/payment-gateways-in-botswana/), third-party).
- **Not worth it at our size.** It needs our own acquiring bank merchant account.

### 3.10 Stripe

- [stripe.com/global](https://stripe.com/global), read 7 Oct 2026: South Africa is listed as **"Extended network"**, linking to paystack.com/stripe/south-africa. **SA businesses cannot open a Stripe account. Paystack is Stripe's SA offering.** Workarounds through a foreign entity (US LLC or UK Ltd) are possible but add tax and compliance overhead and are out of scope.

### 3.11 Paddle (merchant of record)

- Fee **5% + 50c** per transaction, all-in ([paddle.com/pricing](https://www.paddle.com/pricing), 7 Oct 2026).
- **ZAR is a supported payment currency** (min charge 12.75) and a **payout currency**, though not a balance currency (balances are held in USD/EUR/GBP/AUD/CAD). **BWP is not supported** ([supported currencies](https://developer.paddle.com/concepts/sell/supported-currencies)).
- SA sellers are supported (Paddle's exclusion list is sanctioned countries; per search summary of [Paddle help](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)).
- **The catch:** Paddle is the legal seller. It charges and remits 15% SA VAT and issues the invoice to the customer. That conflicts with "we issue our own VAT invoice", and B2B customers get a Paddle invoice. It costs roughly 2 percentage points more than Paystack. Its proration and seat-based subscriptions are excellent, though.

### 3.12 Lemon Squeezy

- Fee 5% + 50c, with "small additional fees" for some international payments. Payouts by bank or PayPal twice a month, 200+ countries ([pricing](https://www.lemonsqueezy.com/pricing), 7 Oct 2026).
- Stripe acquired it in 2024 and is migrating merchants to **Stripe Managed Payments**, reportedly about 6.4% + 30c (third-party: [Paritydeals](https://www.paritydeals.com/lemon-squeezy-vs-stripe-fees/), designrevision.com). **Not recommended:** the platform is in transition and has the same invoicing conflict as Paddle.

---

## 4. Recommendation

### Primary: Paystack, using saved-card charges (we run the billing)

1. **It fits our pricing model.** `charge_authorization` takes any amount on any date. We calculate base + extra users + add-ons + pro-rata in Postgres, issue our own VAT invoice, then charge the exact invoice total. Provider plans (Paystack's, or Payfast "subscriptions") would fight per-seat, mid-month changes.
2. **It is the cheapest and simplest to run.** Fees are 2.9% + R1 local and 3.1% + R1 international. There are no monthly fees, **payouts are free**, and payout is T+2. On a R1,723.85 charge that is R50.99 ex VAT, against R57.16 + R8.70 per payout on Payfast and R61.83 on Peach.
3. **It has the best developer experience.** It is a clean JSON REST API with HMAC-signed webhooks, separate test keys, a maintained official TypeScript SDK and Stripe-quality docs. It fits Next.js on Vercel plus Supabase edge functions.

**How it maps to the spec:**

- **30-day trial without a card.** Nothing touches Paystack during the trial. At conversion, the customer pays invoice #1 through Paystack Checkout (Popup or redirect, with 3DS). That payment creates the reusable authorization. Store `authorization_code`, `signature`, `email`, `country_code` and `reusable`.
- **Upgrades and downgrades.**
  - Option A: charge a pro-rata top-up immediately with `charge_authorization`.
  - Option B (simpler): add the pro-rata line to next month's invoice.
- **Failed payments.** Listen for `charge.success` and failed charges (synchronous response plus webhook). Run our own retry schedule, for example day +1, +3 and +7, then suspend. Send the customer to a new Checkout to replace the card, which creates a new authorization.
- **Botswana customers.** Same flow, charged in ZAR as international cards. Enable international payments at signup. Show "you will be charged R X; your bank converts to BWP and may add a foreign transaction fee" on the invoice and checkout. Watch `country_code = BW` authorizations closely in the first months.

### Backup card processor: Payfast by Network

- Same architecture: tokenization (`subscription_type=2`) with a R0.00 card save, then `/subscriptions/:token/adhoc` with any amount in cents.
- Keep a thin `PaymentProvider` interface (`createCardSetupSession`, `chargeSaved(amount, ref)`, `verifyWebhook`) so Payfast can be added if Paystack declines us, freezes funds, or Botswana cards fail.
- Saved cards **cannot be moved** between providers. A switch means customers re-enter their cards.

### Optional debit orders: Netcash (SA customers only, phase 2)

- Add it only if SA SMEs ask for debit orders.
- Registered Mandate suits SME subscriptions. DebiCheck is stronger but adds friction: the customer approves in their banking app, and the mandate fixes or caps the amount, so a variable per-seat bill needs a mandate with a maximum amount.
- If debit-order volume becomes significant, get a Stitch quote too.

### Botswana BWP (only if needed): DPO Pay by Network

- Only relevant if a Botswana customer must pay in BWP to a Botswana account. That probably means a Botswana-registered entity; to be confirmed with DPO.

---

## 5. What the owner must do to sign up (Paystack first)

**Decide first: sole proprietor or (Pty) Ltd?**
- **Sole proprietor** works, but Paystack caps collections at **ZAR 1,000,000** until you upgrade.
- **(Pty) Ltd** removes the cap and looks better to B2B customers. It is also simpler for the Payfast backup.

**Paystack (South Africa) checklist**
1. Create an account at paystack.com, choose **South Africa** and the business type. Do this yourself; the assistant did not create an account.
2. Prepare documents (all names must match):
   - **Sole prop:** SA ID, proof of address (6 months old at most), bank confirmation letter (6 months old at most), contact details, personal or business bank account.
   - **Registered business:** CIPC registration certificate, CIPC enterprise number, bank confirmation letter for the **company** account (6 months old at most), details of at least one director.
3. During onboarding, answer **Yes to "accept international payments"**, which is needed for Botswana cards. If you missed it: Dashboard → Settings → Preferences → "Request international payments". Expect a reply within 48 working hours.
4. Add your VAT number so you can download Paystack's monthly tax invoice (input VAT).
5. In Settings → API Keys & Webhooks, set the live and test webhook URLs (e.g. `https://<app>/api/webhooks/paystack`). Store the secret keys in Vercel and Supabase secrets.
6. Website and legal: Paystack typically reviews the site, so have a live site with pricing, Terms, Privacy, and Refund/Cancellation policy, plus contact details. This is general practice, not from a Paystack page.
7. Run a live R1–R10 test with an SA card and a **Botswana-issued card** (the first live customer), then refund.

**Payfast backup checklist (optional, can be done in parallel)**
1. Sign up at payfast.io. You need an SA bank account.
2. Documents: SA ID or passport, proof of address (3 months old at most), bank confirmation letter or statement. A Pty Ltd also needs CIPC documents, proof of business address, IDs of all directors and beneficial ownership. Verification takes about 2 business days.
3. Set a **passphrase** (required for recurring) and enable Recurring Billing in Settings → Recurring Billing. Configure the ITN URL.

**Netcash (only if debit orders are wanted)**
- Contact Netcash for a quote (debit-order module, per-transaction, unpaid, DebiCheck TT1/TT2, eMandate). Expect FICA and company documents, a credit and risk assessment, and a sponsoring-bank process. Ask them to enable DebiCheck explicitly.

---

## 6. Things I could not verify

1. **Whether Botswana-issued cards succeed on merchant-initiated saved-card charges** with Paystack (or Payfast or Peach). The official pages only say international Visa/MC are accepted. Issuer behaviour for cross-border charges without 3DS is unknown, as is the share of BW cards that come back `reusable: true`. **Biggest open risk:** test with the first live customer's card.
2. **Paystack's SA international fee.** The pricing page says 3.1% + R1; a support article says 2.9% + R1 for SA. Also unknown: whether international payments will be approved for a *sole proprietor* account.
3. Whether **Payfast tokenization accepts debit cards** (as opposed to credit or cheque cards). The docs say "only the credit card option".
4. **Peach** go-live time, whether recurring is enabled self-serve on the Growth plan, and webhook format (the docs page returned 404).
5. **Netcash** current fees (only old Sage Pay-era third-party figures), and the quality of its API.
6. **Stitch** pricing and minimum volume for DebiCheck or card collections. Whether Stitch Express exposes any API for custom recurring.
7. **DPO Pay Botswana**: actual fees, the monthly fee (P200–P300 is third-party), whether an SA-registered business can get BWP settlement or needs a Botswana entity, and how the 180-day rolling reserve would apply.
8. **Paddle**: whether it would accept a small SA B2B SaaS and how it handles customer-supplied VAT numbers for SA B2B (it charges 15% on B2B and B2C in ZA). Lemon Squeezy's exact migration timeline.
9. **Botswana customer-side costs**: cross-border or FX fees charged by FNB Botswana, Absa Botswana and Stanbic on ZAR card payments.
10. **Tax and exchange control**: SA VAT treatment of services exported to a Botswana business (likely zero-rated as exported services, but confirm with an accountant), and any SARB reporting on cross-border card inflows. Not researched in depth.
