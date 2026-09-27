import { NextResponse, type NextRequest } from "next/server";
import { verifyDocumensoSecret } from "@/lib/integrations/documenso";
import { createAdminClient } from "@/lib/supabase/admin";

// Documenso → The Switchboard: marks the clinician agreement as signed.
export async function POST(request: NextRequest) {
  const secret = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  if (!verifyDocumensoSecret(request.headers.get("x-documenso-secret"), secret)) {
    return NextResponse.json({ error: "Bad secret" }, { status: 401 });
  }
  const body = (await request.json()) as { event?: string; payload?: { id?: number; completedAt?: string } };
  if (body.event !== "DOCUMENT_COMPLETED" || !body.payload?.id) return NextResponse.json({ ignored: true });

  const { data, error } = await createAdminClient().rpc("record_agreement_signed", {
    p_ref: String(body.payload.id),
    p_signed_at: body.payload.completedAt ?? new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ result: data });
}
