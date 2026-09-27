import { EnquiryForm } from "./enquiry-form";

export const metadata = { title: "Make an enquiry", robots: { index: true, follow: true } };

export default function EnquirePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tell us about your child</h1>
        <p className="mt-2 text-stone-700">
          It only takes a couple of minutes. Next, you&apos;ll book a free 15-minute call with our intake team, and we&apos;ll find the right
          clinician from there.
        </p>
      </div>
      <EnquiryForm />
    </div>
  );
}
