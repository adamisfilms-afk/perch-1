"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Checkbox, CheckboxGroup, Field, Input, Select, Textarea } from "@/components/ui";
import {
  CONCERN_LABELS,
  CONCERNS,
  FAMILY_STATUS_LABELS,
  FUNDING_LABELS,
  FUNDING_TYPES,
  INTEREST_LABELS,
  SERVICE_LABELS,
  SERVICE_TYPES,
  SPECIAL_INTERESTS,
  TIME_BLOCK_LABELS,
  TIME_BLOCKS,
  type FamilyStatus,
} from "@/lib/domain";
import { formatAuMobile } from "@/lib/phone";
import type { ChildRow, FamilyRow } from "@/lib/types";

export function FamilyDetailsForm({ action, family }: { action: FormAction; family: FamilyRow }) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Parent or carer" name="parent_name">
          <Input name="parent_name" defaultValue={family.parent_name} />
        </Field>
        <Field label="Email" name="email">
          <Input name="email" type="email" defaultValue={family.email} />
        </Field>
        <Field label="Mobile" name="mobile">
          <Input name="mobile" type="tel" defaultValue={formatAuMobile(family.mobile)} />
        </Field>
        <Field label="Funding" name="funding_type">
          <Select name="funding_type" options={FUNDING_TYPES.map((f) => [f, FUNDING_LABELS[f]] as const)} defaultValue={family.funding_type} />
        </Field>
        <Field label="Suburb" name="suburb">
          <Input name="suburb" defaultValue={family.suburb} />
        </Field>
        <Field label="Postcode" name="postcode">
          <Input name="postcode" inputMode="numeric" maxLength={4} defaultValue={family.postcode} />
        </Field>
        <Field label="Plan manager" name="plan_manager">
          <Input name="plan_manager" defaultValue={family.plan_manager ?? ""} />
        </Field>
      </div>
      <Checkbox name="complex_case" defaultChecked={family.complex_case}>
        Complex case: a clinical lead must approve the match
      </Checkbox>
      <SubmitButton variant="secondary" size="sm">
        Save family details
      </SubmitButton>
    </ActionForm>
  );
}

/** Child fields shared by the child editor and the intake script. */
function ChildFields({ child, includeName = true }: { child: ChildRow; includeName?: boolean }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {includeName && (
          <Field label="First name" name="first_name">
            <Input name="first_name" defaultValue={child.first_name} />
          </Field>
        )}
        <Field label="Age" name="age_years">
          <Input name="age_years" type="number" min={0} max={25} defaultValue={child.age_years ?? ""} />
        </Field>
        <Field label="Date of birth" name="dob">
          <Input name="dob" type="date" defaultValue={child.dob ?? ""} />
        </Field>
      </div>
      <CheckboxGroup legend="Concerns" name="concerns" options={CONCERNS.map((c) => [c, CONCERN_LABELS[c]] as const)} defaultValues={child.concerns} />
      <Field label="Other concern" name="concern_other">
        <Input name="concern_other" maxLength={300} defaultValue={child.concern_other ?? ""} />
      </Field>
      <CheckboxGroup
        legend="Service"
        name="service_type"
        type="radio"
        options={SERVICE_TYPES.map((s) => [s, SERVICE_LABELS[s]] as const)}
        defaultValues={[child.service_type]}
      />
      <CheckboxGroup legend="Preferred times" name="preferred_times" options={TIME_BLOCKS.map((t) => [t, TIME_BLOCK_LABELS[t]] as const)} defaultValues={child.preferred_times} />
      <CheckboxGroup
        legend="Special interests needed (used for scoring)"
        name="interests_needed"
        options={SPECIAL_INTERESTS.map((i) => [i, INTEREST_LABELS[i]] as const)}
        defaultValues={child.interests_needed}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Main language at home (if not English)" name="language">
          <Input name="language" defaultValue={child.language ?? ""} />
        </Field>
        <Field label="Clinician gender preference" name="gender_preference">
          <Select
            name="gender_preference"
            options={[
              ["", "No preference"],
              ["female", "Female"],
              ["male", "Male"],
            ]}
            defaultValue={child.gender_preference ?? ""}
          />
        </Field>
      </div>
      <Checkbox name="telehealth_ok" defaultChecked={child.telehealth_ok}>
        Family is happy with telehealth
      </Checkbox>
      <Field label="Notes for the clinician" name="notes_intake" hint="Only what's needed to make the match. Not clinical notes. Max 2,000 characters.">
        <Textarea name="notes_intake" maxLength={2000} defaultValue={child.notes_intake ?? ""} />
      </Field>
    </>
  );
}

export function ChildForm({ action, child }: { action: FormAction; child: ChildRow }) {
  return (
    <ActionForm action={action}>
      <ChildFields child={child} />
      <SubmitButton variant="secondary" size="sm">
        Save child
      </SubmitButton>
    </ActionForm>
  );
}

export function StatusForm({ action, options }: { action: FormAction; options: FamilyStatus[] }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <div className="space-y-3">
        <Field label="Move to" name="status">
          <Select name="status" placeholder="Choose…" options={options.map((s) => [s, FAMILY_STATUS_LABELS[s]] as const)} />
        </Field>
        <Field label="Reason" name="reason" hint="Required for Lost, Not suitable and Withdrawn">
          <Input name="reason" />
        </Field>
        <SubmitButton variant="secondary">Update</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The structured intake script (spec A2). */
export function IntakeForm({ action, family, child, previous }: {
  action: FormAction;
  family: FamilyRow;
  child: ChildRow;
  previous: Record<string, string | null> | null;
}) {
  const p = previous ?? {};
  return (
    <ActionForm action={action}>
      <ol className="list-decimal space-y-5 pl-5 marker:font-semibold marker:text-brand-700">
        <li>
          <Field label={<>What&apos;s worrying you most about {child.first_name}&apos;s communication or development?</>} name="needs">
            <Textarea name="needs" defaultValue={p.needs ?? ""} />
          </Field>
        </li>
        <li>
          <Field label="Have they seen a speech pathologist or OT before? Any reports?" name="history">
            <Textarea name="history" defaultValue={p.history ?? ""} />
          </Field>
        </li>
        <li>
          <Field label="Any diagnoses you'd like to share?" name="diagnoses" hint="Only what the family chooses to tell us.">
            <Input name="diagnoses" defaultValue={p.diagnoses ?? ""} />
          </Field>
        </li>
        <li className="space-y-3">
          <p className="font-medium">Funding and NDIS plan</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Funding" name="funding_type">
              <Select name="funding_type" options={FUNDING_TYPES.map((f) => [f, FUNDING_LABELS[f]] as const)} defaultValue={family.funding_type} />
            </Field>
            <Field label="Plan manager" name="plan_manager">
              <Input name="plan_manager" defaultValue={family.plan_manager ?? ""} />
            </Field>
            <Field label="Funding available for therapy" name="ndis_funding_available">
              <Input name="ndis_funding_available" defaultValue={p.ndis_funding_available ?? ""} />
            </Field>
            <Field label="Plan end date" name="ndis_plan_end">
              <Input name="ndis_plan_end" type="date" defaultValue={p.ndis_plan_end ?? ""} />
            </Field>
          </div>
        </li>
        <li>
          <Field label="Home visits: anything the clinician should know about access?" name="home_access" hint="Parking, stairs, pets">
            <Input name="home_access" defaultValue={p.home_access ?? ""} />
          </Field>
        </li>
        <li className="space-y-3">
          <p className="font-medium">About {child.first_name}: times, language and preferences</p>
          <ChildFields child={child} includeName={false} />
          <Field label="Any other preferences" name="other_preferences">
            <Input name="other_preferences" defaultValue={p.other_preferences ?? ""} />
          </Field>
          <Checkbox name="complex_case" defaultChecked={family.complex_case}>
            Complex case: needs a clinical lead to approve the match
          </Checkbox>
        </li>
      </ol>
      <Field label="Coordinator notes (internal, not shared)" name="intake_notes">
        <Textarea name="intake_notes" maxLength={4000} />
      </Field>
      <fieldset className="space-y-2 rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-semibold">Outcome</legend>
        <CheckboxGroup
          legend=""
          name="outcome"
          type="radio"
          options={[
            ["ready_to_match", "Ready to match"],
            ["needs_follow_up", "Needs follow-up"],
            ["not_suitable", "Not suitable"],
          ]}
        />
        <Field label="Reason, and signposting advice if not suitable" name="outcome_reason" hint="Sent to the family if they're not suitable">
          <Textarea name="outcome_reason" />
        </Field>
      </fieldset>
      <SubmitButton>Save intake</SubmitButton>
    </ActionForm>
  );
}

export interface ShortlistOption {
  id: string;
  name: string;
  score: number;
  distance: string;
  notes: string[];
  breakdown: Record<string, number>;
}

export function ShortlistForm({ action, options }: { action: FormAction; options: ShortlistOption[] }) {
  return (
    <ActionForm action={action}>
      <ol className="space-y-2">
        {options.map((o, i) => (
          <li key={o.id}>
            <label className="flex cursor-pointer gap-3 rounded-lg border border-stone-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
              <input type="checkbox" name="clinician_id" value={o.id} defaultChecked={i < 3} className="mt-1 size-4 accent-brand-600" />
              <span className="flex-1 text-sm">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {i + 1}. {o.name}
                  </span>
                  <span className="text-stone-600">
                    Score <strong>{o.score}</strong> · {o.distance}
                  </span>
                </span>
                {o.notes.length > 0 && <span className="mt-1 block text-stone-600">{o.notes.join(" · ")}</span>}
                <span className="mt-1 block text-xs text-stone-500">
                  {Object.entries(o.breakdown)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ol>
      <SubmitButton variant="secondary">Save as shortlist</SubmitButton>
    </ActionForm>
  );
}

export function WithdrawForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} confirm="Withdraw this offer? The next clinician on the shortlist will be offered.">
      <div className="flex gap-2">
        <Input name="reason" aria-label="Reason for withdrawing" placeholder="Reason" className="min-w-0" />
        <SubmitButton variant="secondary" size="sm">
          Withdraw
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
