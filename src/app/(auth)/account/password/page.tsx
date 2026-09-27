import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Set your password" };

export default async function PasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">Set your password</h1>
      <p className="text-sm text-stone-600">Use at least 12 characters. A short phrase is easier to remember than a jumble.</p>
      <PasswordForm />
    </Card>
  );
}
