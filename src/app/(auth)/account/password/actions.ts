"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { createClient } from "@/lib/supabase/server";

export async function setPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 12) return { error: "Use at least 12 characters" };
  if (password !== fd.get("confirm")) return { error: "The two passwords don't match" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/mfa");
}
