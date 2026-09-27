// Validation for the public forms. Runs on the server (never trust the browser).

import { z } from "zod";
import { isValidAbn, cleanAbn } from "./abn";
import { ENQUIRY_CONCERNS, FUNDING_TYPES, PROFESSIONS, SERVICE_TYPES, SPECIAL_INTERESTS, TIME_BLOCKS } from "./domain";
import { normaliseAuMobile } from "./phone";
import { todayInAustralia } from "./time";

const trimmed = (max: number) => z.string().trim().min(1, "Required").max(max);

const mobile = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normaliseAuMobile(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter an Australian mobile number, like 0412 345 678" });
      return z.NEVER;
    }
    return n;
  });

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const postcode = z.string().trim().regex(/^\d{4}$/, "Enter a 4-digit postcode");

export const enquirySchema = z
  .object({
    parent_name: trimmed(200),
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    mobile,
    suburb: trimmed(100),
    postcode,
    child_first_name: trimmed(100),
    dob: z.preprocess(emptyToUndefined, z.iso.date().optional()),
    age_years: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(25).optional()),
    concerns: z.array(z.enum(ENQUIRY_CONCERNS as [string, ...string[]])).min(1, "Tick at least one"),
    concern_other: z.string().trim().max(300).optional(),
    service_type: z.enum(SERVICE_TYPES),
    funding_type: z.enum(FUNDING_TYPES),
    preferred_times: z.array(z.enum(TIME_BLOCKS)).default([]),
    referral_source: z.string().trim().max(200).optional(),
    consent_privacy: z.literal(true, { error: "Please read and accept the privacy collection notice" }),
    consent_contact: z.literal(true, { error: "We need your permission to contact you" }),
    consent_share: z.literal(true, { error: "We need your permission to share your details with a matched clinician" }),
  })
  .superRefine((v, ctx) => {
    if (!v.dob && v.age_years === undefined) {
      ctx.addIssue({ code: "custom", path: ["age_years"], message: "Enter your child's age or date of birth" });
    }
    if (v.dob && v.dob > todayInAustralia()) {
      ctx.addIssue({ code: "custom", path: ["dob"], message: "Date of birth can't be in the future" });
    }
    if (v.concerns.includes("other") && !v.concern_other) {
      ctx.addIssue({ code: "custom", path: ["concern_other"], message: "Tell us a little about the concern" });
    }
  });

export type EnquiryInput = z.infer<typeof enquirySchema>;

export const applicationSchema = z.object({
  name: trimmed(200),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  mobile,
  profession: z.enum(PROFESSIONS),
  experience_years: z.coerce.number().int().min(0).max(70),
  suburb: trimmed(100),
  postcode,
  suburbs: trimmed(1000),
  availability: trimmed(1000),
  interests: z.array(z.enum(SPECIAL_INTERESTS)).default([]),
  ndis_registration_status: trimmed(100),
  abn: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? cleanAbn(v) : undefined))
    .refine((v) => !v || isValidAbn(v), "That ABN doesn't look right: check the 11 digits"),
  referral_source: z.string().trim().max(200).optional(),
  consent_privacy: z.literal(true, { error: "Please accept the privacy collection notice" }),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

/** Turn FormData (with repeated checkbox names) into a plain object zod can read. */
export function formDataToObject(fd: FormData, arrays: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION") || key === "cf-turnstile-response") continue;
    const values = fd.getAll(key).map((v) => (typeof v === "string" ? v : ""));
    if (arrays.includes(key)) out[key] = values.filter(Boolean);
    else if (values[0] === "on") out[key] = true;
    else out[key] = values[0];
  }
  for (const key of arrays) out[key] ??= [];
  return out;
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
