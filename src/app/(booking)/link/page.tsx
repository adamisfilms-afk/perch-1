import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { requestLink } from "./actions";

export const metadata = { title: "Get your Perch link" };

/** Clinicians don't log in: this emails them the private link to their page. */
export default function LinkPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Get your Perch link</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Clinicians don&apos;t need a password. Enter the email address you signed up with and we&apos;ll email you the private link to your page, where you
          can update your profile, available times and documents.
        </p>
      </div>
      <ActionForm action={requestLink} resetOnSuccess>
        <Field label="Email" name="email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton pendingText="Sending…">Email me my link</SubmitButton>
      </ActionForm>
    </div>
  );
}
