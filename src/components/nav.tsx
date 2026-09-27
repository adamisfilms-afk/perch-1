"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

export function NavLinks({ links, home }: { links: { href: string; label: string; count?: number }[]; home: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-1 whitespace-nowrap">
        {links.map((l) => {
          // The home link only lights up on the home page itself, not on every page below it.
          const active = pathname === l.href || (l.href !== home && pathname.startsWith(`${l.href}/`));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
                  active ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
                )}
              >
                {l.label}
                {l.count ? <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">{l.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
