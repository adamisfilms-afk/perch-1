"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, CheckboxGroup, Field, Input, Select } from "@/components/ui";
import {
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
import { submitEnquiry } from "./actions";
import { TurnstileClient } from "@/components/turnstile-client";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export function EnquiryForm() {
  return (
    <ActionForm action={submitEnquiry}>
      {({ fieldErrors: e = {}, values: v = {} }) => (
        <>
          <Card className="space-y-4">
            <h2 className="font-semibold">About you</h2>
            <Field label="Your name" name="parent_name" required error={e.parent_name}>
              <Input name="parent_name" autoComplete="name" defaultValue={str(v.parent_name)} error={e.parent_name} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" name="email" required error={e.email}>
                <Input name="email" type="email" autoComplete="email" defaultValue={str(v.email)} error={e.email} />
              </Field>
              <Field label="Mobile" name="mobile" required error={e.mobile}>
                <Input name="mobile" type="tel" autoComplete="tel" inputMode="tel" placeholder="0412 345 678" defaultValue={str(v.mobile)} error={e.mobile} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Suburb" name="suburb" required error={e.suburb}>
                <Input name="suburb" autoComplete="address-level2" defaultValue={str(v.suburb)} error={e.suburb} />
              </Field>
              <Field label="Postcode" name="postcode" required error={e.postcode}>
                <Input name="postcode" inputMode="numeric" autoComplete="postal-code" maxLength={4} defaultValue={str(v.postcode)} error={e.postcode} />
              </Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="font-semibold">About your child</h2>
            <Field label="Child's first name" name="child_first_name" required error={e.child_first_name}>
              <Input name="child_first_name" defaultValue={str(v.child_first_name)} error={e.child_first_name} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Age (years)" name="age_years" hint="Or enter their date of birth" error={e.age_years}>
                <Input name="age_years" type="number" min={0} max={25} inputMode="numeric" defaultValue={str(v.age_years)} error={e.age_years} />
              </Field>
              <Field label="Date of birth" name="dob" error={e.dob}>
                <Input name="dob" type="date" defaultValue={str(v.dob)} error={e.dob} />
              </Field>
            </div>
            <CheckboxGroup
              legend="What's the main concern?"
              name="concerns"
              required
              options={ENQUIRY_CONCERNS.map((c) => [c, CONCERN_LABELS[c]] as const)}
              defaultValues={arr(v.concerns)}
              error={e.concerns}
            />
            <Field label="If other, tell us a little more" name="concern_other" error={e.concern_other}>
              <Input name="concern_other" maxLength={300} defaultValue={str(v.concern_other)} error={e.concern_other} />
            </Field>
            <CheckboxGroup
              legend="Which service are you looking for?"
              name="service_type"
              type="radio"
              required
              options={SERVICE_TYPES.map((s) => [s, SERVICE_LABELS[s]] as const)}
              defaultValues={arr([v.service_type])}
              error={e.service_type}
            />
            <Field label="How will you pay for sessions?" name="funding_type" required error={e.funding_type}>
              <Select
                name="funding_type"
                placeholder="Choose one"
                options={FUNDING_TYPES.map((f) => [f, FUNDING_LABELS[f]] as const)}
                defaultValue={str(v.funding_type)}
                error={e.funding_type}
              />
            </Field>
            <CheckboxGroup
              legend="Preferred times (optional)"
              name="preferred_times"
              options={TIME_BLOCKS.map((t) => [t, TIME_BLOCK_LABELS[t]] as const)}
              defaultValues={arr(v.preferred_times)}
            />
            <Field label="How did you hear about us? (optional)" name="referral_source">
              <Select name="referral_source" placeholder="Choose one" options={REFERRAL_SOURCES.map((s) => [s, s] as const)} defaultValue={str(v.referral_source)} />
            </Field>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">Your consent</h2>
            <Checkbox name="consent_privacy" defaultChecked={v.consent_privacy === true} error={e.consent_privacy}>
              I&apos;ve read the{" "}
              <Link href="/privacy" target="_blank" className="text-brand-700 underline">
                privacy collection notice
              </Link>
              .
            </Checkbox>
            <Checkbox name="consent_contact" defaultChecked={v.consent_contact === true} error={e.consent_contact}>
              You can contact me by email, phone and text about this enquiry.
            </Checkbox>
            <Checkbox name="consent_share" defaultChecked={v.consent_share === true} error={e.consent_share}>
              You can share my details with the clinician who accepts the referral.
            </Checkbox>
          </Card>

          <TurnstileClient />
          <SubmitButton pendingText="Sending…" className="w-full sm:w-auto">
            Send enquiry
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
