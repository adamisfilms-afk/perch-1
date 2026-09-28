import Link from "next/link";
import { SimpleActionButton } from "@/components/forms";
import { TimeOffEditor, WeeklyHoursEditor } from "@/components/booking/hours-editor";
import { PageTabsHeader } from "@/components/workspace/summary-parts";
import { requireStaff } from "@/lib/auth";
import { CALL_LABELS, DEFAULT_BOOKING_SETTINGS, parseBookingSettings, type AppointmentKind, type BookingSettings } from "@/lib/booking/settings";
import { childFullName } from "@/lib/client-summary";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { firstOf } from "@/lib/types";
import { addMyDaysOff, cancelCall, removeMyDaysOff, saveBookingSettings, saveMyHours } from "./actions";
import { BookingSettingsForm } from "./settings-form";

export const metadata = { title: "Calls" };

type One<T> = T | T[] | null;
type CallRow = {
  id: string;
  kind: AppointmentKind;
  starts_at: string;
  ends_at: string;
  family_id: string | null;
  clinician_id: string | null;
  host_profile: One<{ full_name: string }>;
  host_clinician: One<{ name: string }>;
  applicant: One<{ name: string }>;
  families: One<{ parent_name: string; children: { first_name: string; last_name: string | null }[] | null }>;
};

export default async function CallsPage() {
  const viewer = await requireStaff();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: me }, { data: hours }, { data: off }, { data: calls }, { data: team }, { data: setting }] = await Promise.all([
    supabase.from("profiles").select("timezone, hosts_signup_calls, hosts_clinician_calls").eq("id", viewer.userId).single(),
    supabase.from("staff_availability").select("day_of_week, start_time, end_time").eq("profile_id", viewer.userId).order("day_of_week").order("start_time"),
    supabase.from("time_off").select("id, starts_on, ends_on, note").eq("profile_id", viewer.userId).gte("ends_on", today).order("starts_on"),
    supabase
      .from("appointments")
      .select(
        "id, kind, starts_at, ends_at, family_id, clinician_id, host_profile:profiles(full_name), host_clinician:clinicians!appointments_host_clinician_id_fkey(name), applicant:clinicians!appointments_clinician_id_fkey(name), families(parent_name, children(first_name, last_name))",
      )
      .eq("status", "booked")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(200),
    supabase.from("profiles").select("id, full_name, hosts_signup_calls, hosts_clinician_calls, staff_availability(id)").in("role", ["admin", "coordinator", "clinical_lead"]).eq("active", true).order("full_name"),
    supabase.from("settings").select("value").eq("key", "booking").maybeSingle(),
  ]);
  const settings: BookingSettings = parseBookingSettings(setting?.value ?? DEFAULT_BOOKING_SETTINGS);
  const rows = (calls ?? []) as unknown as CallRow[];
  const isAdmin = viewer.role === "admin";

  const who = (c: CallRow) => {
    if (c.kind === "clinician_intake") return { name: firstOf(c.applicant)?.name ?? "Clinician", href: `/clinicians/${c.clinician_id}` };
    const f = firstOf(c.families);
    const children = (f?.children ?? []).map(childFullName).join(" & ");
    return { name: children ? `${children} (${f?.parent_name})` : (f?.parent_name ?? "Family"), href: `/families/${c.family_id}` };
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageTabsHeader label="Calls" tabs={[{ href: "/calls", label: "Calls", active: true }]} />

      <div className="space-y-10 px-4 py-6 md:px-8">
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Upcoming calls</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing booked.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse whitespace-nowrap text-left text-[13px]">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
                    <th scope="col" className="py-2.5 pr-4 font-normal">When</th>
                    <th scope="col" className="py-2.5 pr-4 font-normal">Call</th>
                    <th scope="col" className="py-2.5 pr-4 font-normal">With</th>
                    <th scope="col" className="py-2.5 pr-4 font-normal">Host</th>
                    <th scope="col" className="py-2.5 font-normal">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-neutral-700">
                  {rows.map((c) => {
                    const w = who(c);
                    return (
                      <tr key={c.id} className="border-b border-neutral-100">
                        <td className="py-2 pr-4 tabular-nums">{formatDateTime(c.starts_at)}</td>
                        <td className="py-2 pr-4">{CALL_LABELS[c.kind]}</td>
                        <td className="py-2 pr-4">
                          <Link href={w.href} className="underline-offset-4 hover:underline">
                            {w.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">{firstOf(c.host_profile)?.full_name ?? firstOf(c.host_clinician)?.name}</td>
                        <td className="py-2 text-right">
                          <SimpleActionButton action={cancelCall.bind(null, c.id)} label="Cancel" variant="secondary" confirm="Cancel this call? They'll be emailed." />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-10 xl:grid-cols-2">
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Your hours for calls</h2>
            <WeeklyHoursEditor
              initial={(hours ?? []).map((h: { day_of_week: number; start_time: string; end_time: string }) => ({
                day: h.day_of_week,
                start: h.start_time.slice(0, 5),
                end: h.end_time.slice(0, 5),
              }))}
              timezone={me?.timezone ?? "Australia/Sydney"}
              action={saveMyHours}
            >
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 text-neutral-600">Calls I take</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="hosts_signup_calls" defaultChecked={me?.hosts_signup_calls ?? false} className="size-4" />
                  Family sign-up calls
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="hosts_clinician_calls" defaultChecked={me?.hosts_clinician_calls ?? false} className="size-4" />
                  Clinician intake calls
                  {!["admin", "clinical_lead"].includes(viewer.role) && <span className="text-neutral-500">(only a clinical lead or admin can record these)</span>}
                </label>
              </fieldset>
            </WeeklyHoursEditor>
          </section>

          <div className="space-y-10">
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Your days off</h2>
              <TimeOffEditor items={off ?? []} addAction={addMyDaysOff} removeAction={removeMyDaysOff} />
            </section>

            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Who takes calls</h2>
              <ul className="divide-y divide-neutral-100 text-sm">
                {(team ?? []).map((p: { id: string; full_name: string; hosts_signup_calls: boolean; hosts_clinician_calls: boolean; staff_availability: { id: string }[] | null }) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="text-neutral-800">{p.full_name}</span>
                    <span className="text-neutral-500">
                      {[p.hosts_signup_calls && "sign-up calls", p.hosts_clinician_calls && "clinician calls"].filter(Boolean).join(" and ") || "no calls"}
                      {(p.hosts_signup_calls || p.hosts_clinician_calls) && !(p.staff_availability ?? []).length && " · no hours set"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {isAdmin && (
              <section>
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Booking settings</h2>
                <BookingSettingsForm settings={settings} action={saveBookingSettings} />
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
