type AddressParts = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
};

// Prefer exact coordinates when we have them; otherwise fall back to the
// formatted address so a place is still mappable right after it's created.
export function mapsQuery(place: AddressParts): string {
  if (place.lat != null && place.lng != null) {
    return `${place.lat},${place.lng}`;
  }
  return [place.name, place.address, place.city, place.state, place.zip]
    .filter(Boolean)
    .join(", ");
}

export function googleMapsUrl(place: AddressParts): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    mapsQuery(place)
  )}`;
}

export function googleMapsEmbedUrl(place: AddressParts): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(
    mapsQuery(place)
  )}&output=embed`;
}
