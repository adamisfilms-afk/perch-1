"use client";

import { ChoiceGroup, CheckField, FormSection, SelectField, TextareaField, TextField } from "@/components/workspace/fields";
import { NewRecordButton } from "@/components/workspace/new-record";
import { INTEREST_LABELS, NDIS_REGISTRATION_STATUSES, PROFESSION_LABELS, PROFESSIONS, REFERRAL_SOURCES, SPECIAL_INTERESTS } from "@/lib/domain";
import { createClinician } from "./actions";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/** "New clinician" on the Clinician Summary: add a clinician without them filling in the Join form. */
export function NewClinicianButton() {
  return (
    <NewRecordButton
      label="New clinician"
      title="New clinician"
      subtitle="They're emailed the same welcome as the Join form: a link to book their intake call, and their Perch page to finish their profile and documents."
      submitLabel="Add clinician"
      action={createClinician}
    >
      {({ fieldErrors: e = {}, values: v = {} }) => (
        <>
          <FormSection title="Clinician">
            <TextField label="Full name" name="name" required autoComplete="off" defaultValue={str(v.name)} error={e.name} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Email" name="email" type="email" required autoComplete="off" defaultValue={str(v.email)} error={e.email} />
              <TextField label="Mobile" name="mobile" type="tel" required placeholder="0412 345 678" defaultValue={str(v.mobile)} error={e.mobile} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Profession" name="profession" required options={PROFESSIONS.map((p) => [p, PROFESSION_LABELS[p]] as const)} defaultValue={str(v.profession)} error={e.profession} />
              <TextField label="Years of experience" name="experience_years" type="number" min={0} max={70} required defaultValue={str(v.experience_years)} error={e.experience_years} />
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <TextField label="Home base (suburb)" name="suburb" required defaultValue={str(v.suburb)} error={e.suburb} />
              <TextField label="Postcode" name="postcode" required inputMode="numeric" maxLength={4} defaultValue={str(v.postcode)} error={e.postcode} />
            </div>
          </FormSection>

          <FormSection title="Work">
            <TextareaField label="Suburbs they cover" name="suburbs" required hint="Or how far they'd travel" defaultValue={str(v.suburbs)} error={e.suburbs} />
            <TextareaField label="When they're available for new families" name="availability" required defaultValue={str(v.availability)} error={e.availability} />
            <ChoiceGroup legend="Special interests" name="interests" options={SPECIAL_INTERESTS.map((i) => [i, INTEREST_LABELS[i]] as const)} defaultValues={arr(v.interests)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="NDIS registration" name="ndis_registration_status" required options={NDIS_REGISTRATION_STATUSES.map((s) => [s, s] as const)} defaultValue={str(v.ndis_registration_status)} error={e.ndis_registration_status} />
              <TextField label="ABN (if they have one)" name="abn" inputMode="numeric" defaultValue={str(v.abn)} error={e.abn} />
            </div>
            <SelectField label="How they heard about us" name="referral_source" options={REFERRAL_SOURCES.map((s) => [s, s] as const)} defaultValue={str(v.referral_source)} />
          </FormSection>

          <FormSection title="Consent">
            <CheckField name="consent_privacy" defaultChecked={v.consent_privacy === true} error={e.consent_privacy}>
              They&apos;ve been told about the privacy collection notice (Perch&apos;s /privacy page)
            </CheckField>
          </FormSection>
        </>
      )}
    </NewRecordButton>
  );
}
