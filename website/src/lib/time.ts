export type RelTime = { unit: "just" | "m" | "h" | "d"; value: number };

/** Convert a timestamp into a coarse relative-time unit + value. */
export function relativeTime(iso: string, now: number = Date.now()): RelTime {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return { unit: "just", value: 0 };
  if (mins < 60) return { unit: "m", value: mins };
  if (mins < 1440) return { unit: "h", value: Math.floor(mins / 60) };
  return { unit: "d", value: Math.floor(mins / 1440) };
}
