/**
 * The company's country, for finding its sites on the map.
 *
 * Geocoding used to assume Botswana: "Botswana" on the end of every query,
 * Google biased to .bw, and a hand-drawn box that refused anything outside it.
 * The country is now a company setting (`country_code`, ISO 3166-1 alpha-2;
 * Gold Fortune is BW), so the same lookups work for a company anywhere — and
 * for Gold Fortune the query Google sees is exactly what it was.
 *
 * Pure, so the route and its tests share it.
 */

/** A two-letter ISO code, upper-case, or null when the company has none. */
export function normaliseCountry(code: unknown): string | null {
  return typeof code === "string" && /^[A-Za-z]{2}$/.test(code.trim())
    ? code.trim().toUpperCase()
    : null;
}

/** "BW" → "Botswana", in English, as Google writes it at the end of an address. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? null;
  } catch {
    return null;
  }
}

/**
 * The text query for a site: its name (for a company that finds its places by
 * name, see `sitesFoundByName`), address and town, then the country. Without
 * the name it is the street address; a site with no address is looked up by
 * its name.
 */
export function siteQuery(
  site: { name: string; address: string | null; city: string | null },
  country: string | null,
  byName = true
): string {
  const useName = byName || !site.address?.trim();
  return [useName ? site.name : null, site.address, site.city, countryName(country)].filter(Boolean).join(", ");
}

/**
 * Whether an address Google returned is in the country. Places text search
 * gives only a formatted address, which ends with the country's name; Geocoding
 * also gives the ISO code, which settles it. No country: anything goes.
 */
export function inCountry(
  country: string | null,
  result: { formattedAddress: string; countryCode?: string | null }
): boolean {
  if (!country) return true;
  if (result.countryCode) return result.countryCode.toUpperCase() === country;
  const name = countryName(country);
  if (!name) return true;
  return result.formattedAddress.toLowerCase().includes(name.toLowerCase());
}
