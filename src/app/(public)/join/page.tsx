import { ApplicationForm } from "./application-form";

export const metadata = { title: "Join the network", robots: { index: true, follow: true } };

export default function JoinPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Join the network</h1>
        <p className="mt-2 text-stone-700">
          We connect families with independent speech pathologists and occupational therapists. You run your own practice and choose
          which referrals to accept. We handle finding families, intake and matching.
        </p>
      </div>
      <ApplicationForm />
    </div>
  );
}
