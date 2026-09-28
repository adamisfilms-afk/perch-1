import { resolveBooking } from "@/lib/server/booking";
import { BookingPicker } from "./booking-picker";

export const metadata = { title: "Book a call", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BookPage({ params }: PageProps<"/book/[token]">) {
  const { token } = await params;
  const view = await resolveBooking(token);
  if (!view) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">This link isn&apos;t valid</h1>
        <p className="text-sm text-neutral-600">Check you copied the whole link from your email, or reply to that email and we&apos;ll help.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{view.heading}</h1>
        <p className="mt-2 text-sm text-neutral-600">{view.intro}</p>
      </div>
      {!view.allowed ? (
        <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700">{view.blockedMessage}</p>
      ) : (
        <BookingPicker token={token} slots={view.slots.map((s) => s.start)} existing={view.existing} minutes={view.minutes} />
      )}
    </div>
  );
}
