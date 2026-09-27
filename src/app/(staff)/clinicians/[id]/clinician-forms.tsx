"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { CLINICIAN_STATUS_LABELS, CREDENTIALS, PAUSE_LABELS, PAUSE_REASONS, type ClinicianStatus, type CredentialType } from "@/lib/domain";

export function StatusForm({ action, options }: { action: FormAction; options: ClinicianStatus[] }) {
  const [status, setStatus] = useState<string>("");
  return (
    <ActionForm action={action} confirm={status === "offboarded" ? "Off-board this clinician? Their portal access ends immediately." : undefined}>
      <Field label="Move to" name="status">
        <Select
          name="status"
          placeholder="Choose…"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={options.map((s) => [s, CLINICIAN_STATUS_LABELS[s]] as const)}
        />
      </Field>
      {status === "paused" && (
        <Field label="Why?" name="pause_reason">
          <Select name="pause_reason" options={PAUSE_REASONS.map((p) => [p, PAUSE_LABELS[p]] as const)} />
        </Field>
      )}
      <Field label="Note" name="reason">
        <Input name="reason" />
      </Field>
      <SubmitButton variant="secondary" size="sm">
        Update status
      </SubmitButton>
    </ActionForm>
  );
}

export function VerifyForm({ action, type, expiresAt, returnTo }: {
  action: FormAction;
  type: CredentialType;
  expiresAt: string | null;
  returnTo?: "verification";
}) {
  const info = CREDENTIALS[type];
  return (
    <ActionForm action={action} className="space-y-3">
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <p className="text-xs text-stone-600">
        {info.verification}
        {info.registerUrl && (
          <>
            {" · "}
            <a href={info.registerUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
              open the register
            </a>
          </>
        )}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {info.expiryTracked && (
          <Field label="Expiry date" name="expires_at">
            <Input name="expires_at" type="date" defaultValue={expiresAt ?? ""} />
          </Field>
        )}
        <Field label="Reason (if rejecting)" name="reason">
          <Input name="reason" />
        </Field>
      </div>
      <div className="flex gap-2">
        <SubmitButton size="sm" name="decision" value="approve">
          Verify
        </SubmitButton>
        <SubmitButton size="sm" variant="secondary" name="decision" value="reject">
          Reject
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SightedForm({ action, types }: { action: FormAction; types: CredentialType[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={action} resetOnSuccess>
      <p className="text-xs text-stone-600">For ID-type documents we record that we saw it, when, and who checked. No copy is stored.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Document" name="type">
          <Select name="type" options={types.map((t) => [t, CREDENTIALS[t].label] as const)} />
        </Field>
        <Field label="Sighted on" name="sighted_at">
          <Input name="sighted_at" type="date" defaultValue={today} />
        </Field>
        <Field label="Expiry date" name="expires_at">
          <Input name="expires_at" type="date" />
        </Field>
        <Field label="Number (optional)" name="number">
          <Input name="number" />
        </Field>
      </div>
      <SubmitButton size="sm" variant="secondary">
        Record as sighted
      </SubmitButton>
    </ActionForm>
  );
}

export function AbnForm({ action, abn }: { action: FormAction; abn: string | null }) {
  return (
    <ActionForm action={action}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="ABN" name="abn">
          <Input name="abn" defaultValue={abn ?? ""} inputMode="numeric" />
        </Field>
        <SubmitButton size="md" variant="secondary">
          Check with ABN Lookup
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AgreementSignedForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Signed on" name="signed_at">
          <Input name="signed_at" type="date" />
        </Field>
        <SubmitButton size="md" variant="secondary">
          Record signature
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function NotesForm({ action, notes }: { action: FormAction; notes: string | null }) {
  return (
    <ActionForm action={action}>
      <Field label="Screening notes" name="screening_notes">
        <Textarea name="screening_notes" maxLength={4000} defaultValue={notes ?? ""} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Save notes
      </SubmitButton>
    </ActionForm>
  );
}

export function OffboardingForm({ action, checklist }: { action: FormAction; checklist: Record<string, unknown> | null }) {
  const c = checklist ?? {};
  const items: [string, string][] = [
    ["families_handed_over", "Current families handed over or transferred"],
    ["records_retention_confirmed", "Record retention confirmed"],
    ["access_removed", "Switchboard and Cal.com access removed"],
    ["final_statement_issued", "Final fee statement issued"],
    ["direct_debit_cancelled", "Direct debit cancelled after the final collection"],
  ];
  return (
    <ActionForm action={action}>
      <Field label="Notice received" name="notice_received_at">
        <Input name="notice_received_at" type="date" defaultValue={(c.notice_received_at as string) ?? ""} />
      </Field>
      <div className="space-y-2">
        {items.map(([k, label]) => (
          <Checkbox key={k} name={k} defaultChecked={Boolean(c[k])}>
            {label}
          </Checkbox>
        ))}
      </div>
      <Field label="Notes" name="notes">
        <Textarea name="notes" defaultValue={(c.notes as string) ?? ""} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Save checklist
      </SubmitButton>
    </ActionForm>
  );
}
