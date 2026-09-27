import { ActionForm, SimpleActionButton, SubmitButton } from "@/components/forms";
import { When } from "@/components/display";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import * as actions from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireStaff(["admin"]);
  const supabase = await createClient();
  const [{ data: settings }, { data: templates }, { data: profiles }, { data: failed }] = await Promise.all([
    supabase.from("settings").select("*").order("key"),
    supabase.from("message_templates").select("*").order("key").order("channel"),
    supabase.from("profiles").select("*").neq("role", "clinician").order("full_name"),
    supabase.from("message_log").select("id, template, channel, recipient_kind, last_error, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Admins only. Every change is recorded in the audit log." />

      <Card>
        <CardTitle>Rules</CardTitle>
        <ul className="divide-y divide-stone-100">
          {(settings ?? []).map((s: { key: string; value: unknown; description: string | null }) => (
            <li key={s.key} className="py-3">
              <ActionForm action={actions.saveSetting.bind(null, s.key)} className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    <p className="text-sm font-medium">{s.key.replaceAll("_", " ")}</p>
                    <p className="text-xs text-stone-500">{s.description}</p>
                  </div>
                  <label className="sr-only" htmlFor={`setting-${s.key}`}>
                    {s.key}
                  </label>
                  <Input id={`setting-${s.key}`} name="value" defaultValue={typeof s.value === "string" ? s.value : JSON.stringify(s.value)} className="font-mono" />
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Staff</CardTitle>
        <ul className="mb-4 divide-y divide-stone-100 text-sm">
          {(profiles ?? []).map((p: { id: string; full_name: string; email: string; role: string; active: boolean }) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {p.full_name} <span className="text-stone-500">· {p.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge>{ROLE_LABELS[p.role]}</Badge>
                {!p.active && <Badge tone="red">No access</Badge>}
                {p.id !== viewer.userId && (
                  <SimpleActionButton
                    action={actions.setUserActive.bind(null, p.id, !p.active)}
                    label={p.active ? "Remove access" : "Restore access"}
                    variant="secondary"
                    confirm={p.active ? `Remove ${p.full_name}'s access now?` : undefined}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
        <ActionForm action={actions.inviteStaff} resetOnSuccess>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label="Name" name="full_name">
              <Input name="full_name" />
            </Field>
            <Field label="Email" name="email">
              <Input name="email" type="email" />
            </Field>
            <Field label="Role" name="role">
              <Select name="role" options={[["coordinator", "Coordinator"], ["clinical_lead", "Clinical lead"], ["admin", "Admin"]]} />
            </Field>
            <SubmitButton>Invite</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardTitle>Message templates</CardTitle>
        <p className="mb-3 text-sm text-stone-600">
          Use <code>{"{{placeholders}}"}</code> such as <code>{"{{parent_first_name}}"}</code>, <code>{"{{child_first_name}}"}</code>,{" "}
          <code>{"{{clinician_name}}"}</code> and the links shown in each template. Keep texts short: SMS is only for time-sensitive messages.
        </p>
        <ul className="space-y-2">
          {(templates ?? []).map((t: { key: string; channel: string; subject: string | null; body: string; description: string | null }) => (
            <li key={`${t.key}-${t.channel}`}>
              <details className="rounded-lg border border-stone-200 p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{t.description ?? t.key}</span> <Badge>{t.channel}</Badge>
                </summary>
                <ActionForm action={actions.saveTemplate.bind(null, t.key, t.channel)} className="mt-3 space-y-2">
                  {t.channel === "email" && (
                    <Field label="Subject" name={`subject-${t.key}`}>
                      <Input id={`subject-${t.key}`} name="subject" defaultValue={t.subject ?? ""} />
                    </Field>
                  )}
                  <Field label="Message" name={`body-${t.key}-${t.channel}`}>
                    <Textarea id={`body-${t.key}-${t.channel}`} name="body" defaultValue={t.body} rows={t.channel === "email" ? 8 : 3} className="font-mono text-sm" />
                  </Field>
                  <SubmitButton size="sm" variant="secondary">
                    Save template
                  </SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Jobs and delivery</CardTitle>
        <div className="mb-4 flex flex-wrap gap-2">
          <SimpleActionButton action={actions.runJob.bind(null, "outbox")} label="Send queued messages now" variant="secondary" />
          <SimpleActionButton action={actions.runJob.bind(null, "offers")} label="Run offer timeouts" variant="secondary" />
          <SimpleActionButton action={actions.runJob.bind(null, "daily")} label="Run daily credential checks" variant="secondary" />
        </div>
        <h3 className="mb-2 text-sm font-medium">Messages that failed after 5 tries</h3>
        {!failed?.length ? (
          <p className="text-sm text-stone-500">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {failed.map((m: { id: string; template: string; channel: string; recipient_kind: string; last_error: string | null; created_at: string }) => (
              <li key={m.id}>
                {m.template} ({m.channel} to {m.recipient_kind}) · <When at={m.created_at} /> · <span className="text-red-700">{m.last_error}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
