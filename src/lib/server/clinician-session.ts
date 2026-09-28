import "server-only";

// A clinician's sign-in on this device: they enter their email, we email a 6-digit code, and a correct code
// starts a 30-day session (see supabase/migrations/20261001000002_clinician_sign_in.sql). The token lives in an
// httpOnly cookie; only its hash is stored. This is separate from staff logins (Supabase Auth with MFA).

import { cookies } from "next/headers";
import { createAdminClient } from "../supabase/admin";

const COOKIE = "perch_clinician";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

/** The signed-in clinician on this device, or null. */
export async function currentClinicianId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const { data, error } = await createAdminClient().rpc("clinician_session", { p_token: token });
  if (error) {
    console.error("clinician_session failed", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Only in a server action or route handler (cookies can't be set while rendering). */
export async function startClinicianSession(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function endClinicianSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await createAdminClient("clinician").rpc("end_clinician_session", { p_token: token });
  store.delete(COOKIE);
}

/** "priya.shah@gmail.com" → "p•••@gmail.com", to show where a code went without revealing the address. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return domain ? `${name.slice(0, 1)}•••@${domain}` : "your email";
}
