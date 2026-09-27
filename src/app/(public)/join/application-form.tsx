"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { TurnstileClient } from "@/components/turnstile-client";
import { Card, Checkbox, CheckboxGroup, Field, Input, Select, Textarea } from "@/components/ui";
import { INTEREST_LABELS, NDIS_REGISTRATION_STATUSES, PROFESSION_LABELS, PROFESSIONS, REFERRAL_SOURCES, SPECIAL_INTERESTS } from "@/lib/domain";
import { submitApplication } from "./actions";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export function ApplicationForm() {
  return (
    <ActionForm action={submitApplication}>
      {({ fieldErrors: e = {}, values: v = {} }) => (
        <>
          <Card className="space-y-4">
            <Field label="Full name" name="name" required error={e.name}>
              <Input name="name" autoComplete="name" defaultValue={str(v.name)} error={e.name} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" name="email" required error={e.email}>
                <Input name="email" type="email" autoComplete="email" defaultValue={str(v.email)} error={e.email} />
              </Field>
              <Field label="Mobile" name="mobile" required error={e.mobile}>
                <Input name="mobile" type="tel" autoComplete="tel" defaultValue={str(v.mobile)} error={e.mobile} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Profession" name="profession" required error={e.profession}>
                <Select
                  name="profession"
                  placeholder="Choose one"
                  options={PROFESSIONS.map((p) => [p, PROFESSION_LABELS[p]] as const)}
                  defaultValue={str(v.profession)}
                  error={e.profession}
                />
              </Field>
              <Field label="Years of experience" name="experience_years" required error={e.experience_years}>
                <Input name="experience_years" type="number" min={0} max={70} inputMode="numeric" defaultValue={str(v.experience_years)} error={e.experience_years} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Your home base (suburb)" name="suburb" required error={e.suburb}>
                <Input name="suburb" defaultValue={str(v.suburb)} error={e.suburb} />
              </Field>
              <Field label="Postcode" name="postcode" required error={e.postcode}>
                <Input name="postcode" inputMode="numeric" maxLength={4} defaultValue={str(v.postcode)} error={e.postcode} />
              </Field>
            </div>
            <Field label="Which suburbs would you cover?" name="suburbs" required error={e.suburbs} hint="Or how far you'd travel from your base">
              <Textarea name="suburbs" defaultValue={str(v.suburbs)} error={e.suburbs} />
            </Field>
            <Field label="When are you available for new families?" name="availability" required error={e.availability} hint="For example: Tue and Thu after 3:30pm, Saturday mornings">
              <Textarea name="availability" defaultValue={str(v.availability)} error={e.availability} />
            </Field>
            <CheckboxGroup
              legend="Special interests"
              name="interests"
              options={SPECIAL_INTERESTS.map((i) => [i, INTEREST_LABELS[i]] as const)}
              defaultValues={arr(v.interests)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="NDIS registration" name="ndis_registration_status" required error={e.ndis_registration_status}>
                <Select
                  name="ndis_registration_status"
                  placeholder="Choose one"
                  options={NDIS_REGISTRATION_STATUSES.map((s) => [s, s] as const)}
                  defaultValue={str(v.ndis_registration_status)}
                  error={e.ndis_registration_status}
                />
              </Field>
              <Field label="ABN (if you have one)" name="abn" error={e.abn}>
                <Input name="abn" inputMode="numeric" defaultValue={str(v.abn)} error={e.abn} />
              </Field>
            </div>
            <Field label="How did you hear about us?" name="referral_source">
              <Select name="referral_source" placeholder="Choose one" options={REFERRAL_SOURCES.map((s) => [s, s] as const)} defaultValue={str(v.referral_source)} />
            </Field>
            <Checkbox name="consent_privacy" defaultChecked={v.consent_privacy === true} error={e.consent_privacy}>
              I&apos;ve read the{" "}
              <Link href="/privacy" target="_blank" className="text-brand-700 underline">
                privacy collection notice
              </Link>
              .
            </Checkbox>
          </Card>
          <TurnstileClient />
          <SubmitButton pendingText="Sending…" className="w-full sm:w-auto">
            Send application
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
