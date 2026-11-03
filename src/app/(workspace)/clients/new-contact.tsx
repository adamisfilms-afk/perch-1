"use client";

import { ChoiceGroup, CheckField, FormSection, SelectField, TextField } from "@/components/workspace/fields";
import { NewRecordButton } from "@/components/workspace/new-record";
import {
  AU_STATE_LABELS,
  AU_STATES,
  CONCERN_LABELS,
  ENQUIRY_CONCERNS,
  FUNDING_LABELS,
  FUNDING_TYPES,
  REFERRAL_SOURCES,
  SERVICE_LABELS,
  SERVICE_TYPES,
  TIME_BLOCK_LABELS,
  TIME_BLOCKS,
} from "@/lib/domain";
import { createContact } from "./actions";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : []);

/** "New contact" on the Client Summary: add a family who got in touch by phone or email. */
export function NewContactButton() {
  return (
    <NewRecordButton
      label="New contact"
      title="New contact"
      subtitle="Add a family who got in touch another way. They're emailed a link to book their sign-up call, as if they'd used the enquiry form."
      submitLabel="Add contact"
      action={createContact}
    >
      {({ fieldErrors: e = {}, values: v = {} }) => (
        <>
          <FormSection title="Parent or carer">
            <TextField label="Name" name="parent_name" required autoComplete="off" defaultValue={str(v.parent_name)} error={e.parent_name} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Email" name="email" type="email" required autoComplete="off" defaultValue={str(v.email)} error={e.email} />
              <TextField label="Mobile" name="mobile" type="tel" required placeholder="0412 345 678" defaultValue={str(v.mobile)} error={e.mobile} />
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <TextField label="Suburb" name="suburb" required defaultValue={str(v.suburb)} error={e.suburb} />
              <SelectField label="State" name="state" required options={AU_STATES.map((s) => [s, AU_STATE_LABELS[s]] as const)} defaultValue={str(v.state)} error={e.state} />
              <TextField label="Postcode" name="postcode" required inputMode="numeric" maxLength={4} defaultValue={str(v.postcode)} error={e.postcode} />
            </div>
          </FormSection>

          <FormSection title="Child">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="First name" name="child_first_name" required defaultValue={str(v.child_first_name)} error={e.child_first_name} />
              <TextField label="Last name" name="child_last_name" required defaultValue={str(v.child_last_name)} error={e.child_last_name} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Age (years)" name="age_years" type="number" min={0} max={25} hint="Or their date of birth" defaultValue={str(v.age_years)} error={e.age_years} />
              <TextField label="Date of birth" name="dob" type="date" defaultValue={str(v.dob)} error={e.dob} />
            </div>
            <ChoiceGroup legend="Main concerns" name="concerns" required options={ENQUIRY_CONCERNS.map((c) => [c, CONCERN_LABELS[c]] as const)} defaultValues={arr(v.concerns)} error={e.concerns} />
            <TextField label="If other, a little more" name="concern_other" maxLength={300} defaultValue={str(v.concern_other)} error={e.concern_other} />
            <ChoiceGroup legend="Service" name="service_type" type="radio" required options={SERVICE_TYPES.map((s) => [s, SERVICE_LABELS[s]] as const)} defaultValues={arr(v.service_type)} error={e.service_type} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Funding" name="funding_type" required options={FUNDING_TYPES.map((f) => [f, FUNDING_LABELS[f]] as const)} defaultValue={str(v.funding_type)} error={e.funding_type} />
              <SelectField label="How they heard about us" name="referral_source" options={REFERRAL_SOURCES.map((s) => [s, s] as const)} defaultValue={str(v.referral_source)} />
            </div>
            <ChoiceGroup legend="Preferred times" name="preferred_times" options={TIME_BLOCKS.map((t) => [t, TIME_BLOCK_LABELS[t]] as const)} defaultValues={arr(v.preferred_times)} />
          </FormSection>

          <FormSection title="Consent (ask them before adding)">
            <CheckField name="consent_privacy" defaultChecked={v.consent_privacy === true} error={e.consent_privacy}>
              They&apos;ve been told about the privacy collection notice (Perch&apos;s /privacy page)
            </CheckField>
            <CheckField name="consent_contact" defaultChecked={v.consent_contact === true} error={e.consent_contact}>
              They&apos;re happy to be contacted by email, phone and text about this enquiry
            </CheckField>
            <CheckField name="consent_share" defaultChecked={v.consent_share === true} error={e.consent_share}>
              They&apos;re happy for their details to be shared with the clinician who accepts the referral
            </CheckField>
          </FormSection>
        </>
      )}
    </NewRecordButton>
  );
}
