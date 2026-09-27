"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../ui";
import { CloseIcon } from "./icons";

/** A native <dialog>: traps focus, closes on Escape, and returns focus to whatever opened it. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      className={cn(
        "m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-xl bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-neutral-900/30",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              {subtitle && <div className="mt-1 text-sm text-neutral-500">{subtitle}</div>}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label="Close">
              <CloseIcon className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="border-t border-neutral-200 px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
