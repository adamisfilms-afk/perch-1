import { Card } from "@/components/ui";

export const metadata = { title: "Thanks" };

export default function Thanks() {
  return (
    <Card className="space-y-3">
      <h1 className="text-2xl font-semibold">Thanks, we&apos;ve got your enquiry</h1>
      <p className="text-stone-700">
        We&apos;ve sent you an email and a text with a link to book your free intake call. Pick a time that suits you and we&apos;ll take it
        from there.
      </p>
      <p className="text-sm text-stone-500">Can&apos;t see it? Check your spam folder, or reply to us and we&apos;ll help.</p>
    </Card>
  );
}
