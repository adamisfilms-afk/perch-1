import { AppShell } from "@/components/app-shell";
import { requireClinician } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const viewer = await requireClinician();
  const supabase = await createClient();
  const { data: offers } = await supabase.rpc("get_my_offers");
  const open = (offers ?? []).filter((o: { state: string }) => o.state === "offered").length;
  return (
    <AppShell
      viewer={viewer}
      home="/portal"
      links={[
        { href: "/portal", label: "Home" },
        { href: "/portal/offers", label: "Referrals", count: open },
        { href: "/portal/families", label: "My families" },
        { href: "/portal/profile", label: "Profile & availability" },
        { href: "/portal/documents", label: "Documents" },
      ]}
    >
      {children}
    </AppShell>
  );
}
