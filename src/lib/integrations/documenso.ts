import "server-only";
import { timingSafeEqual } from "node:crypto";

// Documenso e-signing for the clinician service agreement.
// A template is set up once in Documenso with a single "Clinician" recipient;
// we create a document from it per clinician and track it by our agreement id.

export interface SendAgreementResult {
  documentId: string;
}

export async function sendAgreementForSignature(opts: {
  agreementId: string;
  name: string;
  email: string;
}): Promise<SendAgreementResult | { skipped: string } | { error: string }> {
  const apiKey = process.env.DOCUMENSO_API_KEY;
  const templateId = process.env.DOCUMENSO_TEMPLATE_ID;
  const base = (process.env.DOCUMENSO_URL ?? "https://app.documenso.com").replace(/\/$/, "");
  if (!apiKey || !templateId) return { skipped: "Documenso isn't configured" };
  try {
    const res = await fetch(`${base}/api/v1/templates/${templateId}/generate-document`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Clinician service agreement: ${opts.name}`,
        externalId: opts.agreementId,
        recipients: [{ id: Number(process.env.DOCUMENSO_TEMPLATE_RECIPIENT_ID ?? 1), name: opts.name, email: opts.email }],
        meta: { subject: "Your clinician service agreement", message: "Please review and sign your agreement." },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { documentId?: number; message?: string };
    if (!res.ok || !data.documentId) return { error: data.message ?? `Documenso returned ${res.status}` };
    const sent = await fetch(`${base}/api/v1/documents/${data.documentId}/send`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ sendEmail: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!sent.ok) return { error: `Document created but not sent (HTTP ${sent.status})` };
    return { documentId: String(data.documentId) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function verifyDocumensoSecret(received: string | null, secret: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
