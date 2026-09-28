import Link from "next/link";

/** Shown when a referral link is wrong, has been reset, or the clinician has been off-boarded. */
export function LinkExpired() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">This link has expired</h1>
      <p className="text-sm text-neutral-600">
        It may have been replaced with a new one.{" "}
        <Link href="/clinician" className="underline underline-offset-4">
          Sign in to your Perch page
        </Link>{" "}
        to see your open referrals, or ask the Perch team.
      </p>
    </div>
  );
}
