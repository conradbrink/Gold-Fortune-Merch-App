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

/** One line under the name, where a page has room for it. */
export const PRODUCT_TAGLINE = "Field work, planned and proven.";

/**
 * The double-tick mark shown with the product name (`public/product-mark.png`,
 * drawn by `mobile/tool/make_product_mark.py` from the logo's geometry).
 */
export const PRODUCT_MARK = "/product-mark.png";
