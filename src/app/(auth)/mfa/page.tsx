import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireMfaSetting } from "@/lib/auth";
import { EnrolForm, VerifyForm } from "./mfa-forms";

export const metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }: PageProps<"/mfa">) {
  const { next: rawNext } = await searchParams;
  const next = typeof rawNext === "string" ? rawNext : "/start";
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  if (data.claims.aal === "aal2" || !(await requireMfaSetting())) redirect(next);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");

  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">Two-step verification</h1>
      {verified ? (
        <>
          <p className="text-sm text-stone-700">Enter the 6-digit code from your authenticator app.</p>
          <VerifyForm factorId={verified.id} next={next} />
        </>
      ) : (
        <>
          <p className="text-sm text-stone-700">
            To protect children&apos;s information, everyone needs an authenticator app (such as Google Authenticator, Microsoft
            Authenticator or 1Password) as well as a password.
          </p>
          <EnrolForm next={next} />
        </>
      )}
    </Card>
  );
}
