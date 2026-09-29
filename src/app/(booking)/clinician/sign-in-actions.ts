"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import type { ActionState } from "@/components/forms";
import { drainOutboxQuietly } from "@/lib/notifications/outbox";
import { resolveClinicianLink } from "@/lib/server/clinician-link";
import { maskEmail, startClinicianSession } from "@/lib/server/clinician-session";
import { clientIp } from "@/lib/server/request";
import { createAdminClient } from "@/lib/supabase/admin";

// Sign-in for clinicians: email → 6-digit code → a 30-day session on this device.
// Opened from the link in an email, the link says who they are (so they needn't type their email); it's
// re-checked on the server and the address is never sent to the browser.

type Db = ReturnType<typeof createAdminClient>;

async function emailFor(db: Db, fd: FormData): Promise<string | null> {
  const token = String(fd.get("token") ?? "");
  if (token) {
    const link = await resolveClinicianLink(token);
    if (!link) return null;
    const { data } = await db.from("clinicians").select("email").eq("id", link.clinicianId).maybeSingle();
    return (data?.email as string | undefined) ?? null;
  }
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function withinLimit(db: Db, what: string, max: number): Promise<boolean> {
  const ip = await clientIp();
  const { data } = await db.rpc("check_rate_limit", { p_key: `${what}:${ip ?? "unknown"}`, p_max: max, p_window_seconds: 3600 });
  return data !== false;
}

export async function requestCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const db = createAdminClient("clinician");
  const email = await emailFor(db, fd);
  if (!email) return { error: fd.get("token") ? "This link has expired. Enter your email instead." : "Enter the email address you signed up with" };
  if (!(await withinLimit(db, "clinician-code", 10))) return { error: "Too many codes requested. Please try again in an hour." };
  const { error } = await db.rpc("request_clinician_code", { p_email: email });
  if (error) {
    console.error("request_clinician_code failed", error.message);
    return { error: "Sorry, something went wrong. Please try again." };
  }
  after(drainOutboxQuietly);
  // The same reply whether or not we know the address.
  return { ok: true, message: `If ${maskEmail(email)} is the email you signed up with, we've sent it a 6-digit code.`, values: { email: fd.get("token") ? "" : email } };
}

export async function verifyCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const db = createAdminClient("clinician");
  const email = await emailFor(db, fd);
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  if (!email) return { error: "Start again: enter your email to get a new code." };
  if (code.length !== 6) return { error: "Enter the 6-digit code from the email" };
  if (!(await withinLimit(db, "clinician-verify", 30))) return { error: "Too many tries. Please try again in an hour." };
  const { data, error } = await db.rpc("verify_clinician_code", { p_email: email, p_code: code });
  if (error) return { error: error.message };
  if (!data) return { error: "That code isn't right. Check the email and try again." };
  await startClinicianSession(data as string);
  redirect("/clinician");
}
