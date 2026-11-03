import type { ReactNode } from "react";
import { BoltIcon, CalendarIcon, PhoneIcon } from "@/components/workspace/icons";
import { PageTabsHeader } from "@/components/workspace/summary-parts";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "Overview" };

type Who = "Family" | "Clinician" | "Staff" | "Automatic";

/** How a step happens: automatically, by booking a time on a calendar, or by a phone call. */
type Kind = "automated" | "booking" | "call";

const KINDS: Record<Kind, { label: string; icon: typeof BoltIcon; className: string }> = {
  automated: { label: "Automated", icon: BoltIcon, className: "text-amber-600" },
  booking: { label: "Calendar booking", icon: CalendarIcon, className: "text-sky-700" },
  call: { label: "Phone call", icon: PhoneIcon, className: "text-emerald-700" },
};

interface Step {
  title: string;
  body: ReactNode;
  who: Who[];
  kinds?: Kind[];
  /** The status in Switchboard once this step is done, if it changes. */
  shows?: string;
  /** What happens if this step doesn't go ahead. */
  otherwise?: { title: string; body: ReactNode };
}

const CLIENT_STEPS: Step[] = [
  {
    title: "Enquiry",
    kinds: ["automated"],
    who: ["Family"],
    shows: "New",
    body: (
      <>
        The family fills in the enquiry form: their child, concerns, funding, suburb and state, and consent. They&apos;re emailed straight away with a link to
        book a sign-up call.
      </>
    ),
  },
  {
    title: "Sign-up call booked",
    kinds: ["booking", "automated"],
    who: ["Family"],
    shows: "Intake call booked",
    body: (
      <>
        They choose a time from the team&apos;s hours (set on <strong>Calls</strong>). Both sides get a confirmation email, and the family gets text reminders
        24 hours and 1 hour before. They can change or cancel from the same link.
      </>
    ),
  },
  {
    title: "Sign-up call",
    kinds: ["call"],
    who: ["Staff"],
    shows: "Ready to match",
    body: <>A coordinator calls the family and fills in the intake script on the client&apos;s full record.</>,
    otherwise: { title: "Not the right fit, or no clinician free yet", body: <>Mark them Not suitable (they&apos;re emailed other options), or move them to the Waitlist.</> },
  },
  {
    title: "Clinician offered",
    kinds: ["automated"],
    who: ["Staff", "Clinician"],
    shows: "Offered to clinician",
    body: (
      <>
        Staff choose a clinician with <strong>Allocate clinician</strong>. The clinician is emailed and texted a summary with no names or contact details, and
        accepts or declines within 48 hours. A text reminder goes out at 24 hours.
      </>
    ),
    otherwise: {
      title: "Declined, or no reply in 48 hours",
      body: <>The client goes back to Ready to match, and staff are told by email and Slack so they can choose someone else.</>,
    },
  },
  {
    title: "Matched",
    kinds: ["automated"],
    who: ["Clinician", "Automatic"],
    shows: "Matched",
    body: (
      <>
        The clinician accepts. The family is emailed a link to book a free intro call in the clinician&apos;s hours, and the clinician is emailed the
        family&apos;s details.
      </>
    ),
  },
  {
    title: "Intro call booked",
    kinds: ["booking", "automated"],
    who: ["Family"],
    shows: "Intro booked",
    body: <>The family chooses a 15-minute time. The clinician is emailed who to call and when, and both get a text reminder the day before.</>,
  },
  {
    title: "Intro call",
    kinds: ["call"],
    who: ["Clinician"],
    shows: "Intro done",
    body: <>Afterwards, the clinician records how it went from the referral link in their email.</>,
    otherwise: { title: "Not going ahead", body: <>The client goes back to Ready to match, the clinician gets the place back, and staff are told.</> },
  },
  {
    title: "First session",
    kinds: ["automated"],
    who: ["Clinician", "Automatic"],
    shows: "Active",
    body: (
      <>
        The clinician confirms the date of the first session (from the referral link, or the one-click email sent 3 days after the intro call). Follow-ups go out
        automatically: the family at 2 weeks, the clinician at 6 weeks.
      </>
    ),
  },
];

const CLINICIAN_STEPS: Step[] = [
  {
    title: "Sign up",
    kinds: ["automated"],
    who: ["Clinician"],
    shows: "New",
    body: (
      <>
        The clinician fills in the &ldquo;Join the network&rdquo; form. Their welcome email has two links: one to book their intake call, and one to their
        Perch page.
      </>
    ),
  },
  {
    title: "Intake call booked",
    kinds: ["booking", "automated"],
    who: ["Clinician"],
    shows: "Intake call booked",
    body: (
      <>
        They choose a time with the team (from the hours on <strong>Calls</strong>, for staff who take clinician calls). They can book straight away, before
        finishing anything else. The host is emailed their details.
      </>
    ),
  },
  {
    title: "Complete their Perch page",
    who: ["Clinician"],
    body: (
      <>
        They sign in at /clinician with their email and a 6-digit code (remembered on that device for 30 days). There they add their profile (ages and funding
        types), their hours for intro calls, and upload their documents. They can do this before or after the call.
      </>
    ),
  },
  {
    title: "Submit application",
    kinds: ["automated"],
    who: ["Clinician"],
    shows: "Application complete (or Intake call booked, if they've booked it)",
    body: <>Once everything&apos;s in, they accept the service agreement and submit. Staff are told by email and Slack.</>,
  },
  {
    title: "Documents checked",
    who: ["Staff"],
    body: (
      <>
        Staff verify each upload on the clinician&apos;s record or in the Verification queue. For home visits, the team also sights their driver&apos;s licence
        and car insurance.
      </>
    ),
    otherwise: { title: "A document isn't right", body: <>Reject it with a reason. The clinician is emailed to upload a new copy.</> },
  },
  {
    title: "Intake call recorded",
    kinds: ["call"],
    who: ["Staff"],
    shows: "Ready",
    body: (
      <>
        A clinical lead or admin records the call (with notes) on the clinician&apos;s record, or chooses <strong>Move to → Ready</strong>. This only works once
        the application is submitted and the documents are verified. The clinician is emailed that they&apos;re ready for referrals.
      </>
    ),
  },
  {
    title: "Referrals",
    kinds: ["automated"],
    who: ["Staff", "Clinician"],
    body: (
      <>
        When staff allocate them a client, they get a summary by email and text to accept or decline. If they accept, they&apos;re emailed the family&apos;s
        details, and the family books an intro call in their hours.
      </>
    ),
  },
  {
    title: "Active",
    kinds: ["automated"],
    who: ["Automatic"],
    shows: "Active",
    body: (
      <>
        Shown once one of their clients has a confirmed first session. From then on, document expiry reminders go out at 60, 30 and 7 days, they&apos;re paused
        automatically if a required document expires, and they&apos;re asked to check their details once a year.
      </>
    ),
  },
];

const WHO_STYLE: Record<Who, string> = {
  Family: "bg-sky-50 text-sky-900",
  Clinician: "bg-violet-50 text-violet-900",
  Staff: "bg-amber-50 text-amber-900",
  Automatic: "bg-neutral-100 text-neutral-600",
};

export default async function OverviewPage({ searchParams }: PageProps<"/overview">) {
  await requireStaff();
  const { flow } = await searchParams;
  const clinicians = flow === "clinicians";

  return (
    <div className="flex min-h-full flex-col">
      <PageTabsHeader
        label="Overview"
        tabs={[
          { href: "/overview", label: "Client onboarding", active: !clinicians },
          { href: "/overview?flow=clinicians", label: "Clinician onboarding", active: clinicians },
        ]}
      />
      <div className="max-w-3xl px-4 py-6 md:px-8">
        <p className="mb-4 text-sm text-neutral-600">
          {clinicians
            ? "How a clinician goes from signing up to seeing clients. Every step is recorded in their History."
            : "How a family goes from their first enquiry to their first session. Every step is recorded in their History."}{" "}
          Each step shows who acts and how it happens, and the status in Switchboard once it&apos;s done.
        </p>
        <ul className="mb-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600" aria-label="Key">
          {(Object.keys(KINDS) as Kind[]).map((k) => {
            const { label, icon: Icon, className } = KINDS[k];
            return (
              <li key={k} className="flex items-center gap-1.5">
                <Icon className={`size-4 ${className}`} />
                {label}
              </li>
            );
          })}
        </ul>
        <Flow steps={clinicians ? CLINICIAN_STEPS : CLIENT_STEPS} />
      </div>
    </div>
  );
}

function Flow({ steps }: { steps: Step[] }) {
  return (
    <ol>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.title} className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
            {/* the line down to the next step */}
            {!last && <span aria-hidden className="absolute bottom-0 left-5 top-10 w-px -translate-x-1/2 bg-neutral-300" />}
            <span
              aria-hidden
              className="relative z-10 flex size-10 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold tabular-nums text-neutral-900"
            >
              {i + 1}
            </span>
            <div className={last ? "pb-2" : "pb-8"}>
              <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-semibold text-neutral-900">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <span className="flex flex-wrap gap-1.5">
                  {s.who.map((w) => (
                    <span key={w} className={`rounded px-1.5 py-0.5 text-xs ${WHO_STYLE[w]}`}>
                      {w}
                    </span>
                  ))}
                </span>
                {s.kinds && (
                  <span className="flex items-center gap-1.5">
                    {s.kinds.map((k) => {
                      const { label, icon: Icon, className } = KINDS[k];
                      return (
                        <span key={k} title={label} className="inline-flex">
                          <Icon className={`size-4 ${className}`} />
                          <span className="sr-only">{label}</span>
                        </span>
                      );
                    })}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-neutral-700">{s.body}</p>
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                Status after this step:
                {s.shows ? (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">{s.shows}</span>
                ) : (
                  <span>no change</span>
                )}
              </p>
              {s.otherwise && (
                <div className="mt-3 rounded-md border-l-2 border-amber-400 bg-amber-50/60 px-3 py-2 text-sm">
                  <p className="font-medium text-neutral-900">If: {s.otherwise.title}</p>
                  <p className="text-neutral-700">{s.otherwise.body}</p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
