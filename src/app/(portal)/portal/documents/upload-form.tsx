"use client";

import { useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, Input, Select } from "@/components/ui";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { createUploadUrl, recordUpload } from "../actions";

const MAX_BYTES = 10 * 1024 * 1024;

export function UploadForm({ types }: { types: readonly (readonly [string, string, boolean])[] }) {
  const [type, setType] = useState(types[0]?.[0] ?? "");
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<{ tone: "red" | "blue" | "green"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const expiryTracked = types.find((t) => t[0] === type)?.[2] ?? false;

  async function upload() {
    const file = fileRef.current?.files?.[0];
    setPath("");
    if (!file) return;
    if (file.size > MAX_BYTES) return setStatus({ tone: "red", text: "That file is over 10 MB. Try a PDF or a smaller photo." });
    setStatus({ tone: "blue", text: "Uploading…" });
    const target = await createUploadUrl(type, file.name);
    if ("error" in target) return setStatus({ tone: "red", text: target.error });
    const { error } = await createBrowserSupabase().storage.from("credentials").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
    if (error) return setStatus({ tone: "red", text: `Upload failed: ${error.message}` });
    setPath(target.path);
    setStatus({ tone: "green", text: "File uploaded. Add the details and send it for checking." });
  }

  return (
    <ActionForm action={recordUpload} resetOnSuccess>
      <Field label="Document" name="type">
        <Select name="type" value={type} onChange={(e) => { setType(e.target.value); setPath(""); setStatus(null); if (fileRef.current) fileRef.current.value = ""; }} options={types.map(([v, l]) => [v, l] as const)} />
      </Field>
      <Field label="File (PDF or photo, up to 10 MB)" name="file">
        <input ref={fileRef} id="file" type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" onChange={upload} className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:text-brand-800" />
      </Field>
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      <input type="hidden" name="path" value={path} />
      <div className="grid gap-3 sm:grid-cols-2">
        {expiryTracked && (
          <Field label="Expiry date" name="expires_at">
            <Input name="expires_at" type="date" />
          </Field>
        )}
        <Field label="Number (if shown)" name="number">
          <Input name="number" />
        </Field>
      </div>
      <SubmitButton pendingText="Sending…">Send for checking</SubmitButton>
    </ActionForm>
  );
}
