import { createBrowserClient } from "@supabase/ssr";

/** Browser client: only used to upload documents straight to storage with a signed upload URL. */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
