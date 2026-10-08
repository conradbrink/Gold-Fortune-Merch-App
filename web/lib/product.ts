/**
 * The product's own name, for everything shown before anyone has signed in —
 * the login and password pages, the download page, the browser title, the
 * phone's home-screen label — and nowhere else. After sign-in every screen
 * shows the company's own name and logo (`lib/branding.ts`).
 *
 * Tickd (the owner's choice, 7 Oct 2026; it replaced the "Field Teams"
 * placeholder). One constant, so the web says it in one place.
 */
export const PRODUCT_NAME = "Tickd";

/**
 * One line under the name, where a page has room for it. The outcome and the
 * proof in one line (owner, 8 Oct 2026, from the offer-angles skill; it
 * replaced "Field work, planned and proven."). Staff see it too, on the
 * download page, so it speaks to both sides: the job done, and proof of it.
 */
export const PRODUCT_TAGLINE = "Every job done, and the proof to show it.";

/**
 * The double-tick mark shown with the product name (`public/product-mark.png`,
 * drawn by `mobile/tool/make_product_mark.py` from the logo's geometry).
 */
export const PRODUCT_MARK = "/product-mark.png";
