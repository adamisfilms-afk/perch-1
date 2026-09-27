"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { createClient } from "@/lib/supabase/server";

/** Start setting up an authenticator app. Clears any half-finished set-up first. */
export async function startEnrol(): Promise<ActionState> {
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: error?.message ?? "Couldn't start set-up" };
  return { ok: true, values: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function verifyCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const factorId = String(fd.get("factorId") ?? "");
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your app", values: Object.fromEntries(fd) };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code didn't work. Check the time on your phone and try the newest code.", values: Object.fromEntries(fd) };
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/start");
}
