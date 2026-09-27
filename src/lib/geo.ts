// Distances and turning a suburb + postcode into map coordinates.

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  state: string | null;
}

const STATE_CODES: Record<string, string> = {
  "new south wales": "NSW",
  victoria: "VIC",
  queensland: "QLD",
  "south australia": "SA",
  "western australia": "WA",
  tasmania: "TAS",
  "australian capital territory": "ACT",
  "northern territory": "NT",
};

/** First-digit postcode ranges, used when the geocoder doesn't return a state. */
export function stateFromPostcode(postcode: string): string | null {
  const n = Number(postcode);
  if (!/^\d{4}$/.test(postcode)) return null;
  if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return "ACT";
  if (n >= 800 && n <= 999) return "NT";
  if (n >= 1000 && n <= 2999) return "NSW";
  if (n >= 3000 && n <= 3999) return "VIC";
  if (n >= 4000 && n <= 4999) return "QLD";
  if (n >= 5000 && n <= 5999) return "SA";
  if (n >= 6000 && n <= 6999) return "WA";
  if (n >= 7000 && n <= 7999) return "TAS";
  return null;
}

/**
 * Suburb + postcode → coordinates using Mapbox. Returns null (never throws) so a form
 * submission is never lost because the map service is down; staff can fix it later.
 */
export async function geocodeSuburb(suburb: string, postcode: string): Promise<GeocodeResult | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null;
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", `${suburb} ${postcode}, Australia`);
  url.searchParams.set("country", "au");
  url.searchParams.set("types", "locality,neighborhood,postcode,place");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: { geometry: { coordinates: [number, number] }; properties?: { context?: { region?: { name?: string } } } }[];
    };
    const f = data.features?.[0];
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    const region = f.properties?.context?.region?.name?.toLowerCase();
    return { lat, lng, state: (region && STATE_CODES[region]) || stateFromPostcode(postcode) };
  } catch {
    return null;
  }
}
