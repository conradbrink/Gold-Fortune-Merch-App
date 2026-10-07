// Everything the sales site says about the business lives here, so a price,
// a phone number or the company name changes in one place.

export const site = {
  name: "Tickd",
  tagline: "Proof, not promises.",
  headline: "See what your field team actually did today.",
  trialDays: 14,
  url: "https://tickd.co.za",
  appUrl: "https://app.tickd.co.za",
  // Legal entity shown in the footer. Confirm before launch.
  legalName: "Mobill Media",
  email: "hello@tickd.co.za",
  // International format without "+" or spaces, e.g. "27821234567".
  // Empty until the WhatsApp Business line exists; the buttons fall back to email.
  whatsapp: "",
  countries: "Southern Africa",
} as const;

// WhatsApp when the business line exists, email until then.
export function contactHref(message: string, subject = message): string {
  if (site.whatsapp) {
    return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
  }
  return `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

export const trialMessage = `Hi, I'd like to start the free ${site.trialDays}-day ${site.name} trial.`;

// Prices in rand, including VAT (owner, 7 Oct 2026). Amounts from requirements doc Draft v6, section 2.
export const pricing = {
  currency: "R",
  base: 1499,
  includedUsers: 3,
  perExtraUser: 349,
  businessPlanFrom: 20,
  addOns: [
    {
      name: "HR",
      price: "R199 / month",
      detail: "Leave, employee records and documents for up to 5 employees. R499 for 6 to 30.",
    },
    {
      name: "Warehouse and deliveries",
      price: "R499 / warehouse / month",
      detail: "Stock, picking, dispatch and proof of delivery. Includes 2 warehouse or driver users.",
    },
  ],
} as const;

export function monthlyPrice(users: number): number {
  const extra = Math.max(0, users - pricing.includedUsers);
  return pricing.base + extra * pricing.perExtraUser;
}

export function rand(amount: number): string {
  // en-US for "R1,499": en-ZA groups with a non-breaking space.
  return `${pricing.currency}${amount.toLocaleString("en-US")}`;
}
