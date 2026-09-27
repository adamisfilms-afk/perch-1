import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Opens a credential document through a 60-second signed link, after checking access and logging it.
export async function GET(request: NextRequest, { params }: RouteContext<"/api/files/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: cred } = await supabase.from("credentials").select("id, file_path").eq("id", id).maybeSingle();
  if (!cred?.file_path) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await supabase.rpc("log_access", { p_entity_type: "credentials", p_entity_id: id, p_action: "download" });
  const { data, error } = await supabase.storage.from("credentials").createSignedUrl(cred.file_path, 60);
  if (error || !data) return NextResponse.json({ error: "Could not open file" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
