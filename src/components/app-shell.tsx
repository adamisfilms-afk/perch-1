import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LABELS } from "@/lib/domain";
import type { Viewer } from "@/lib/auth";
import { NavLinks } from "./nav";

export function AppShell({
  viewer,
  links,
  home,
  children,
}: {
  viewer: Viewer;
  links: { href: string; label: string; count?: number }[];
  home: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl space-y-2 px-4 pb-2 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Link href={home} className="font-semibold text-brand-700">
              The Switchboard
            </Link>
            <div className="flex items-center gap-3 text-sm text-stone-600">
              <span className="hidden sm:inline">
                {viewer.fullName} · {ROLE_LABELS[viewer.role]}
              </span>
              <form action="/auth/signout" method="post">
                <button type="submit" className="min-h-9 rounded-lg px-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                  Log out
                </button>
              </form>
            </div>
          </div>
          <NavLinks links={links} home={home} />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
