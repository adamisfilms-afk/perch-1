import { Card } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { FirstSessionTokenForm } from "./token-form";

export const metadata = { title: "First session", robots: { index: false } };

// One-click answer from the "Did the first session get booked?" email. No login needed:
// the link carries a single-use token, and only the date can be recorded with it.
export default async function FirstSessionLink({ searchParams }: PageProps<"/r/first-session">) {
  const { token } = await searchParams;
  const t = typeof token === "string" ? token : "";
  const { data } = t ? await createAdminClient().rpc("peek_action_token", { p_token: t }) : { data: null };
  const valid = Boolean(data?.[0]?.valid);

  return (
    <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
      <Card className="space-y-4">
        <h1 className="text-xl font-semibold">Did the first session get booked?</h1>
        {valid ? (
          <FirstSessionTokenForm token={t} />
        ) : (
          <p className="text-sm text-stone-700">This link has expired or has already been used. You can update it any time from your portal.</p>
        )}
      </Card>
    </main>
  );
}
