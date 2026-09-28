import Link from "next/link";

/** Shown when a clinician's link is wrong, has been reset, or they've been off-boarded. */
export function LinkExpired() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">This link has expired</h1>
      <p className="text-sm text-neutral-600">
        It may have been replaced with a new one.{" "}
        <Link href="/link" className="underline underline-offset-4">
          Get your current link by email
        </Link>
        , or ask the Perch team.
      </p>
    </div>
  );
}
