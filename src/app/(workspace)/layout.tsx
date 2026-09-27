import { Sidebar } from "@/components/workspace/sidebar";
import { requireStaff } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/domain";

// The redesigned staff workspace. Pages move in here one at a time; the rest still use the (staff) layout.
export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const viewer = await requireStaff();
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-neutral-900 md:flex-row">
      <Sidebar name={viewer.fullName} role={ROLE_LABELS[viewer.role]} />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
