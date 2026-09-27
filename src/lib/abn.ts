// ABN checks: the official checksum, plus a lookup against the Australian Business Register.

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Validates an ABN using the ATO's modulus-89 checksum. Accepts spaces. */
export function isValidAbn(input: string): boolean {
  const abn = input.replace(/\s/g, "");
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split("").map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((acc, d, i) => acc + d * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

export function cleanAbn(input: string): string {
  return input.replace(/\s/g, "");
}

export interface AbnLookupResult {
  abn: string;
  active: boolean;
  entityName: string;
  gstRegistered: boolean;
}

/**
 * Looks the ABN up on ABN Lookup (https://abr.business.gov.au/Tools/WebServices).
 * Returns null if the service isn't configured or can't be reached, so callers can retry later.
 */
export async function lookupAbn(input: string): Promise<AbnLookupResult | null> {
  const guid = process.env.ABN_LOOKUP_GUID;
  const abn = cleanAbn(input);
  if (!guid || !isValidAbn(abn)) return null;
  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abn}&callback=cb&guid=${encodeURIComponent(guid)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return parseAbnResponse(await res.text());
  } catch {
    return null;
  }
}

/** The ABR JSON service wraps its answer in a JSONP callback: cb({...}). */
export function parseAbnResponse(body: string): AbnLookupResult | null {
  const json = body.trim().replace(/^[\w$]+\(/, "").replace(/\);?$/, "");
  const data = JSON.parse(json) as {
    Abn?: string;
    AbnStatus?: string;
    EntityName?: string;
    BusinessName?: string[];
    Gst?: string | null;
    Message?: string;
  };
  if (!data.Abn) return null;
  return {
    abn: data.Abn,
    active: data.AbnStatus === "Active",
    entityName: data.EntityName || data.BusinessName?.[0] || "",
    gstRegistered: Boolean(data.Gst),
  };
}
