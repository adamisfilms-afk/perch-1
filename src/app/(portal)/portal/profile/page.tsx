import { AvailabilityForm, ClinicianProfileForm } from "@/components/clinician-profile-form";
import { SimpleActionButton } from "@/components/forms";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { When } from "@/components/display";
import { requireClinician } from "@/lib/auth";
import { daysSince } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";
import type { AvailabilityRow, ClinicianRow } from "@/lib/types";
import { confirmYearlyCheck, updateMyAvailability, updateMyProfile } from "../actions";

export const metadata = { title: "Profile & availability" };

export default async function ProfilePage() {
  const viewer = await requireClinician();
  const supabase = await createClient();
  const [{ data: me }, { data: slots }] = await Promise.all([
    supabase.from("clinicians").select("*").eq("id", viewer.clinicianId).single<ClinicianRow>(),
    supabase.from("availability").select("*").eq("clinician_id", viewer.clinicianId).order("day_of_week"),
  ]);
  if (!me) return null;
  const due = !me.last_recredentialed_at || daysSince(me.last_recredentialed_at) > 330;
  return (
    <div className="space-y-6">
      <PageHeader title="Profile & availability" description="This is what matching uses. Keep it current and you'll get referrals that suit you." />
      {due && (
        <Card className="border-amber-300 bg-amber-50">
          <CardTitle>Yearly check-in</CardTitle>
          <p className="mb-3 text-sm">Please check your profile, capacity and insurance below are still right, then confirm.</p>
          <SimpleActionButton action={confirmYearlyCheck} label="Everything's up to date" />
        </Card>
      )}
      <Card>
        <CardTitle>Available times</CardTitle>
        <AvailabilityForm action={updateMyAvailability} slots={(slots ?? []) as AvailabilityRow[]} />
      </Card>
      <Card>
        <CardTitle>Profile</CardTitle>
        <ClinicianProfileForm action={updateMyProfile} clinician={me} />
      </Card>
      {me.last_recredentialed_at && (
        <p className="text-xs text-stone-500">
          Last confirmed <When at={me.last_recredentialed_at} />
        </p>
      )}
    </div>
  );
}
