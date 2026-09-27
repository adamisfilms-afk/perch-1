import { AppShell } from "@/components/app-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const viewer = await requireStaff();
  const supabase = await createClient();
  const [{ count: pending }, { count: waitlist }] = await Promise.all([
    supabase.from("credentials").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("families").select("id", { count: "exact", head: true }).eq("status", "waitlist"),
  ]);
  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/clients", label: "Clients" },
    { href: "/families", label: "Families" },
    { href: "/waitlist", label: "Waitlist", count: waitlist ?? 0 },
    { href: "/clinicians", label: "Clinicians" },
    { href: "/verification", label: "Verification", count: pending ?? 0 },
    { href: "/metrics", label: "Metrics" },
    ...(viewer.role === "admin" ? [{ href: "/settings", label: "Settings" }] : []),
  ];
  return (
    <AppShell viewer={viewer} links={links} home="/dashboard">
      {children}
    </AppShell>
  );
}
