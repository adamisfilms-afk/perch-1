import { resolveSessionsCheck } from "@/lib/server/sessions";
import { formatDate } from "@/lib/time";
import { AnswerForm } from "./answer-form";

export const metadata = { title: "Your sessions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** A family confirms last month's session count (from the link in our monthly text and email). */
export default async function SessionsCheckPage({ params }: PageProps<"/check/[token]">) {
  const { token } = await params;
  const check = await resolveSessionsCheck(token);
  if (!check) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="text-sm text-neutral-600">Reply to our message and we&apos;ll sort it out.</p>
      </div>
    );
  }
  const month = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${check.month}T00:00:00Z`));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hi {check.parentFirstName}: your sessions in {month}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          We have <strong>{check.sessionCount}</strong> session{check.sessionCount === 1 ? "" : "s"} with {check.clinicianFirstName} recorded for {month}.
        </p>
      </div>
      {check.sessionDates.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm">
          {check.sessionDates.map((d) => (
            <li key={d} className="px-4 py-2 tabular-nums">
              {formatDate(d)}
            </li>
          ))}
        </ul>
      )}
      {check.status !== "pending" && (
        <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          {check.status === "confirmed" ? "You confirmed this. Thanks!" : `You told us this isn't right${check.note ? `: "${check.note}"` : ""}. The team will be in touch.`} You
          can change your answer below.
        </p>
      )}
      <AnswerForm token={token} />
    </div>
  );
}
