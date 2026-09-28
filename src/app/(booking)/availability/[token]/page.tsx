import { TimeOffEditor, WeeklyHoursEditor } from "@/components/booking/hours-editor";
import { loadAvailability, resolveAvailabilityLink } from "@/lib/server/booking";
import { formatDateTime } from "@/lib/time";
import { addDaysOff, removeDaysOff, saveHours } from "./actions";

export const metadata = { title: "Your availability", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AvailabilityPage({ params }: PageProps<"/availability/[token]">) {
  const { token } = await params;
  const link = await resolveAvailabilityLink(token);
  const view = link ? await loadAvailability(link.clinicianId) : null;
  if (!view) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="text-sm text-neutral-600">Ask the Perch team to send you a new link to your availability.</p>
      </div>
    );
  }
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hi {view.firstName}: your availability</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Families we match you with book a free {view.introMinutes}-minute intro call in these times. Keep this link private: anyone with it
          can change your hours.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Weekly hours for intro calls</h2>
        <WeeklyHoursEditor initial={view.windows} timezone={view.timezone} action={saveHours.bind(null, token)} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Days off</h2>
        <TimeOffEditor items={view.timeOff} addAction={addDaysOff.bind(null, token)} removeAction={removeDaysOff.bind(null, token)} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Upcoming intro calls</h2>
        {view.upcoming.length === 0 ? (
          <p className="text-sm text-neutral-500">None booked yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {view.upcoming.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 py-2">
                <span>{formatDateTime(c.startsAt, view.timezone)}</span>
                <span className="text-neutral-600">{c.childName ? `Intro call about ${c.childName}` : "Intro call"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-neutral-500">Family contact details are in the email we send when they book, and in your portal.</p>
      </section>
    </div>
  );
}
