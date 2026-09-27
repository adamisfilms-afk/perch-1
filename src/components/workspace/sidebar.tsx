"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../ui";
import { FolderIcon, GridIcon, PersonIcon } from "./icons";

const LINKS = [
  { href: "/clients", label: "Clients", icon: FolderIcon },
  { href: "/clinicians", label: "Clinicians", icon: PersonIcon },
  { href: "/dashboard", label: "Dashboards", icon: GridIcon },
];

export function Sidebar({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  return (
    <aside className="flex shrink-0 flex-col border-neutral-200 bg-neutral-100/80 md:sticky md:top-0 md:h-screen md:w-64 md:border-r lg:w-72">
      <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-4 md:block md:px-7 md:pb-8 md:pt-10">
        <Link href="/clients" className="block">
          <span className="block text-2xl font-bold tracking-tight md:text-3xl">Switchboard</span>
          <span className="block text-xs text-neutral-600">for Perch</span>
        </Link>
      </div>
      <nav aria-label="Main" className="overflow-x-auto px-3 md:px-6">
        <ul className="flex gap-1 md:flex-col md:gap-0.5">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-8 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-sm",
                    active ? "bg-neutral-200/80 text-neutral-900" : "text-neutral-700 hover:bg-neutral-200/50 hover:text-neutral-900",
                  )}
                >
                  <Icon className="size-3.5 text-neutral-500" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto hidden border-t border-neutral-200 px-7 py-5 text-sm md:block">
        <p className="font-medium text-neutral-800">{name}</p>
        <p className="text-neutral-500">{role}</p>
        <form action="/auth/signout" method="post" className="mt-2">
          <button type="submit" className="text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline">
            Log out
          </button>
        </form>
      </div>
    </aside>
  );
}
