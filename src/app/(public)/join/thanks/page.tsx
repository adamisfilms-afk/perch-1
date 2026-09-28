import { Card } from "@/components/ui";

export const metadata = { title: "Thanks for signing up" };

export default function Thanks() {
  return (
    <Card className="space-y-3">
      <h1 className="text-2xl font-semibold">Thanks for signing up</h1>
      <p className="text-stone-700">
        We&apos;ve emailed you a private link to your own Perch page (no password needed). There you can complete your profile, set your
        available times, upload your documents and submit your application.
      </p>
      <p className="text-stone-700">Once it&apos;s submitted, we&apos;ll send you a link to book a short intake call with our team.</p>
    </Card>
  );
}
