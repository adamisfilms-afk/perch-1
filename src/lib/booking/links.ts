// Signed links for booking pages and the clinician availability page (no login).
// A link names one family, clinician or match and is signed with a server secret, so it can't be
// altered to reach anyone else's booking. The availability link also carries a version number:
// staff bump clinicians.availability_link_version to cancel an old link.

import { createHmac, timingSafeEqual } from "node:crypto";

export type LinkKind = "signup_call" | "clinician_intake" | "intro_call" | "availability";

const PREFIX: Record<LinkKind, string> = { signup_call: "s", clinician_intake: "c", intro_call: "i", availability: "a" };
const KIND_BY_PREFIX = Object.fromEntries(Object.entries(PREFIX).map(([k, p]) => [p, k])) as Record<string, LinkKind>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** BOOKING_LINK_SECRET if set, otherwise derived from the service role key (already a server secret). */
export function linkSecret(): string {
  const explicit = process.env.BOOKING_LINK_SECRET;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Missing BOOKING_LINK_SECRET (or SUPABASE_SERVICE_ROLE_KEY)");
  return createHmac("sha256", base).update("switchboard-booking-links").digest("hex");
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url").slice(0, 22);
}

export function makeLinkToken(secret: string, kind: LinkKind, id: string, version?: number): string {
  const body = kind === "availability" ? `${PREFIX[kind]}.${id}.${version ?? 1}` : `${PREFIX[kind]}.${id}`;
  return `${body}.${sign(secret, body)}`;
}

export interface LinkRef {
  kind: LinkKind;
  id: string;
  version: number | null;
}

export function readLinkToken(secret: string, token: string): LinkRef | null {
  const parts = token.split(".");
  const kind = KIND_BY_PREFIX[parts[0]];
  if (!kind) return null;
  const expectedParts = kind === "availability" ? 4 : 3;
  if (parts.length !== expectedParts || !UUID.test(parts[1])) return null;
  const body = parts.slice(0, -1).join(".");
  const given = Buffer.from(parts[parts.length - 1]);
  const wanted = Buffer.from(sign(secret, body));
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  const version = kind === "availability" ? Number(parts[2]) : null;
  if (version !== null && (!Number.isInteger(version) || version < 1)) return null;
  return { kind, id: parts[1].toLowerCase(), version };
}

export function bookingPath(secret: string, kind: Exclude<LinkKind, "availability">, id: string): string {
  return `/book/${makeLinkToken(secret, kind, id)}`;
}

export function availabilityPath(secret: string, clinicianId: string, version: number): string {
  return `/availability/${makeLinkToken(secret, "availability", clinicianId, version)}`;
}
