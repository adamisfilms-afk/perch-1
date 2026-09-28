"use client";

import { useState } from "react";

/** A link with a Copy button, for booking and availability links staff send by text or email. */
export function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-neutral-600">{label}</span>
      <span className="flex items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline">
          Open
        </a>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-50"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </span>
    </div>
  );
}
