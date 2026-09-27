"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/server/request";
import { env } from "@/lib/env";

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/start";
}

export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password", values: { email } };

  const ip = await clientIp();
  const { data: allowed } = await createAdminClient().rpc("check_rate_limit", {
    p_key: `login:${ip ?? "unknown"}:${email}`,
    p_max: 10,
    p_window_seconds: 900,
  });
  if (allowed === false) return { error: "Too many attempts. Wait 15 minutes and try again.", values: { email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "That email and password don't match", values: { email } };
  redirect(`/mfa?next=${encodeURIComponent(safeNext(fd.get("next")))}`);
}

export async function sendReset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email" };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl()}/auth/confirm?next=/account/password` });
  // Same answer whether or not the account exists.
  return { ok: true, message: "If that email has an account, we've sent a link to reset your password." };
}
