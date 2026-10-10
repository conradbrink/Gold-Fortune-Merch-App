type AddressParts = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
};

/**
 * Whether a company's places are looked up by name as well as address. A
 * distributor's places are named outlets in known malls (Google finds
 * "Choppies Hyper, Game City"); a service company's places are people's
 * properties, where the name is the owner's own label ("Daniels Plot") that
 * Google has never heard of and that turns the search into a list of random
 * shops. So only a company that delivers to outlets uses the name.
 */
export function sitesFoundByName(modules: ReadonlySet<string>): boolean {
  return modules.has("distribution");
}

// Prefer exact coordinates when we have them; otherwise fall back to the
// formatted address so a place is still mappable right after it's created.
// The street address on its own, unless the company finds its places by name
// too; and a place with no address at all is searched by its name, which is
// better than searching for nothing.
export function mapsQuery(place: AddressParts, byName = false): string {
  if (place.lat != null && place.lng != null) {
    return `${place.lat},${place.lng}`;
  }
  const clean = (v?: string | null) => v?.trim() ?? "";
  const where = [place.address, place.city, place.state, place.zip].map(clean).filter(Boolean);
  return (byName || !clean(place.address) ? [clean(place.name), ...where] : where).filter(Boolean).join(", ");
}

export function googleMapsUrl(place: AddressParts, byName = false): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    mapsQuery(place, byName)
  )}`;
}

export function googleMapsEmbedUrl(place: AddressParts, byName = false): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(
    mapsQuery(place, byName)
  )}&output=embed`;
}
