import { formatDateTime } from "@/lib/time";
import type { ActivityItem } from "./activity-list";

/** The latest few events, for a record's overview. The History tab has everything. */
export function RecentActivity({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="text-sm text-stone-500">Nothing yet.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {items.map((h, n) => (
        <li key={n}>
          <span>{h.text}</span>
          <span className="block text-xs text-stone-500">
            {formatDateTime(h.at)} · {h.by}
            {h.note && ` · ${h.note}`}
          </span>
        </li>
      ))}
    </ol>
  );
}
