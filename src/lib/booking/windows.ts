// Reads the weekly hours submitted by WeeklyHoursEditor (a JSON list of {day, start, end}).

export interface Window {
  day: number;
  start: string;
  end: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseWindows(fd: FormData): { windows: Window[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("windows") ?? "[]"));
  } catch {
    return { error: "Couldn't read the hours. Please try again." };
  }
  if (!Array.isArray(raw) || raw.length > 50) return { error: "Couldn't read the hours. Please try again." };
  const windows: Window[] = [];
  for (const w of raw as Record<string, unknown>[]) {
    const day = Number(w.day);
    const start = String(w.start ?? "");
    const end = String(w.end ?? "");
    if (!Number.isInteger(day) || day < 1 || day > 7 || !TIME.test(start) || !TIME.test(end)) return { error: "Enter each time as hours and minutes" };
    if (end <= start) return { error: "Each block of hours must end after it starts" };
    windows.push({ day, start, end });
  }
  const overlap = windows.some((a, i) => windows.some((b, j) => i !== j && a.day === b.day && a.start < b.end && b.start < a.end));
  if (overlap) return { error: "Some hours overlap on the same day. Join them into one block." };
  return { windows };
}
