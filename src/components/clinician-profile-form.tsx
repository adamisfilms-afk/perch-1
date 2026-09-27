"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { Button, Checkbox, CheckboxGroup, Field, Input, Select } from "./ui";
import { AGE_GROUP_LABELS, AGE_GROUPS, DAY_LABELS, FUNDING_LABELS, FUNDING_TYPES, INTEREST_LABELS, SPECIAL_INTERESTS } from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import type { AvailabilityRow, ClinicianRow } from "@/lib/types";

export function ClinicianProfileForm({ action, clinician }: { action: FormAction; clinician: ClinicianRow }) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name">
          <Input name="name" defaultValue={clinician.name} />
        </Field>
        <Field label="Mobile" name="mobile">
          <Input name="mobile" type="tel" defaultValue={formatAuMobile(clinician.mobile)} />
        </Field>
        <Field label="Years of experience" name="experience_years">
          <Input name="experience_years" type="number" min={0} max={70} defaultValue={clinician.experience_years ?? ""} />
        </Field>
        <Field label="Gender" name="gender" hint="Some families ask for a particular gender">
          <Select
            name="gender"
            options={[
              ["undisclosed", "Prefer not to say"],
              ["female", "Female"],
              ["male", "Male"],
              ["non_binary", "Non-binary"],
            ]}
            defaultValue={clinician.gender ?? "undisclosed"}
          />
        </Field>
        <Field label="Languages (comma separated)" name="languages">
          <Input name="languages" defaultValue={clinician.languages.join(", ")} />
        </Field>
        <Field label="Cal.com intro-call link" name="calcom_intro_url" hint="Families get this link when you accept">
          <Input name="calcom_intro_url" type="url" placeholder="https://cal.com/you/intro" defaultValue={clinician.calcom_intro_url ?? ""} />
        </Field>
      </div>

      <CheckboxGroup
        legend="Special interests"
        name="interests"
        options={SPECIAL_INTERESTS.map((i) => [i, INTEREST_LABELS[i]] as const)}
        defaultValues={clinician.interests}
      />
      <CheckboxGroup legend="Age groups you see" name="age_groups" options={AGE_GROUPS.map((a) => [a, AGE_GROUP_LABELS[a]] as const)} defaultValues={clinician.age_groups} />
      <CheckboxGroup
        legend="Funding types you accept"
        name="funding_types"
        hint="Agency-managed NDIS needs NDIS registration."
        options={FUNDING_TYPES.filter((f) => f !== "unsure").map((f) => [f, FUNDING_LABELS[f]] as const)}
        defaultValues={clinician.funding_types}
      />

      <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-semibold">Service area</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Home base suburb" name="suburb">
            <Input name="suburb" defaultValue={clinician.suburb ?? ""} />
          </Field>
          <Field label="Postcode" name="postcode">
            <Input name="postcode" inputMode="numeric" maxLength={4} defaultValue={clinician.postcode ?? ""} />
          </Field>
          <Field label="Max travel (km)" name="radius_km">
            <Input name="radius_km" type="number" min={0} max={300} step="0.5" defaultValue={clinician.radius_km ?? ""} />
          </Field>
        </div>
        <Field label="Or: postcodes you cover" name="service_postcodes" hint="Separate with commas or spaces">
          <Input name="service_postcodes" defaultValue={clinician.service_postcodes.join(", ")} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Checkbox name="home_visits" defaultChecked={clinician.home_visits}>
            I do home visits
          </Checkbox>
          <Checkbox name="telehealth" defaultChecked={clinician.telehealth}>
            I offer telehealth
          </Checkbox>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-semibold">Capacity</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New families I can take" name="capacity_new" hint="Goes down by one each time you accept a referral">
            <Input name="capacity_new" type="number" min={0} max={50} defaultValue={clinician.capacity_new} />
          </Field>
          <Field label="Not taking new referrals until" name="snoozed_until" hint="Leave blank if you're taking referrals">
            <Input name="snoozed_until" type="date" defaultValue={clinician.snoozed_until ?? ""} />
          </Field>
        </div>
      </fieldset>
      <SubmitButton>Save profile</SubmitButton>
    </ActionForm>
  );
}

interface Slot {
  key: number;
  day: number;
  start: string;
  end: string;
}

export function AvailabilityForm({ action, slots }: { action: FormAction; slots: AvailabilityRow[] }) {
  const [rows, setRows] = useState<Slot[]>(
    slots.length
      ? slots.map((s, i) => ({ key: i, day: s.day_of_week, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) }))
      : [{ key: 0, day: 2, start: "15:30", end: "18:00" }],
  );
  const update = (key: number, patch: Partial<Slot>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <ActionForm action={action}>
      <p className="text-sm text-stone-600">When can you see new families each week? Matching uses these to find families whose preferred times overlap.</p>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
            <Field label={i === 0 ? "Day" : <span className="sr-only">Day</span>} name={`slot_day_${r.key}`}>
              <Select
                id={`slot_day_${r.key}`}
                name="slot_day"
                value={r.day}
                onChange={(e) => update(r.key, { day: Number(e.target.value) })}
                options={[1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), DAY_LABELS[d]] as const)}
              />
            </Field>
            <Field label={i === 0 ? "From" : <span className="sr-only">From</span>} name={`slot_start_${r.key}`}>
              <Input id={`slot_start_${r.key}`} name="slot_start" type="time" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} />
            </Field>
            <Field label={i === 0 ? "To" : <span className="sr-only">To</span>} name={`slot_end_${r.key}`}>
              <Input id={`slot_end_${r.key}`} name="slot_end" type="time" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${DAY_LABELS[r.day]} ${r.start}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows((x) => [...x, { key: Date.now(), day: 6, start: "09:00", end: "12:00" }])}>
          Add a time block
        </Button>
        <SubmitButton size="sm">Save times</SubmitButton>
      </div>
    </ActionForm>
  );
}
