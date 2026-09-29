"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/time";

export interface ActivityItem {
  at: string;
  text: string;
  note: string | null;
  by: string;
  source: "event" | "message";
}

/** Everything that's happened, newest first, with the emails and texts we sent shown or hidden. */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  const [showMessages, setShowMessages] = useState(true);
  const shown = showMessages ? items : items.filter((i) => i.source === "event");
  const messages = items.filter((i) => i.source === "message").length;
  return (
    <div className="space-y-3">
      {messages > 0 && (
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={showMessages} onChange={(e) => setShowMessages(e.target.checked)} className="size-4" />
          Show emails and texts we sent ({messages})
        </label>
      )}
      {!shown.length ? (
        <p className="text-sm text-neutral-500">Nothing yet.</p>
      ) : (
        <ol className="space-y-2 border-l border-neutral-200 pl-4 text-sm">
          {shown.map((h, n) => (
            <li key={n}>
              <p className={h.source === "message" ? "text-neutral-600" : "text-neutral-900"}>{h.text}</p>
              <p className="text-neutral-500">
                {formatDateTime(h.at)} · {h.by}
                {h.note && ` · ${h.note}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
