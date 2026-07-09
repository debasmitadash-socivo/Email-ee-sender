// Send scheduling: jitter, campaign send window in the lead's timezone,
// hard compliance hours (06:00–21:00 lead-local, §14). Pure functions;
// Deno twin in supabase/functions/_shared/schedule.ts.
import { JITTER_MIN_S, JITTER_MAX_S, COMPLIANCE_HOUR_MIN, COMPLIANCE_HOUR_MAX } from "@/config/ramp";
import type { SendWindow } from "@/lib/types";

export const DEFAULT_WINDOW: SendWindow = { start: "08:30", end: "17:30", days: [1, 2, 3, 4, 5] };

export function jitterSeconds(rand: () => number = Math.random): number {
  return JITTER_MIN_S + Math.floor(rand() * (JITTER_MAX_S - JITTER_MIN_S));
}

/** Local wall-clock parts of `date` in an IANA timezone. */
export function localParts(date: Date, timeZone: string): { minutes: number; isoDay: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(date);
  } catch {
    // invalid tz string → fall back to UTC
    return localParts(date, "UTC");
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { minutes: hour * 60 + minute, isoDay: dayMap[get("weekday")] ?? 1 };
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Snap `candidate` FORWARD to the first instant inside both the campaign
 * window (lead timezone) and the absolute compliance hours. 15-min steps,
 * bounded at 14 days.
 */
export function snapIntoWindow(candidate: Date, window: SendWindow, timeZone: string): Date {
  const win = { ...DEFAULT_WINDOW, ...window };
  const startM = hmToMinutes(win.start);
  const endM = hmToMinutes(win.end);
  const compMin = COMPLIANCE_HOUR_MIN * 60;
  const compMax = COMPLIANCE_HOUR_MAX * 60;
  const days = win.days?.length ? win.days : DEFAULT_WINDOW.days;

  let t = new Date(candidate);
  for (let i = 0; i < (14 * 24 * 60) / 15; i++) {
    const { minutes, isoDay } = localParts(t, timeZone);
    const inWindow = days.includes(isoDay) && minutes >= startM && minutes <= endM;
    const inCompliance = minutes >= compMin && minutes <= compMax;
    if (inWindow && inCompliance) return t;
    t = new Date(t.getTime() + 15 * 60_000);
  }
  return t; // pathological window; caller validates windows at launch
}

/** next_send_at for a step: base + delay days + jitter, snapped into window. */
export function computeNextSendAt(args: {
  base: Date;
  delayDays: number;
  window: SendWindow;
  timeZone: string;
  rand?: () => number;
}): Date {
  const withDelay = new Date(args.base.getTime() + args.delayDays * 86_400_000);
  const withJitter = new Date(withDelay.getTime() + jitterSeconds(args.rand) * 1000);
  return snapIntoWindow(withJitter, args.window, args.timeZone);
}

/** Push +N business days (OOO handling). */
export function addBusinessDays(from: Date, n: number, timeZone: string): Date {
  let t = new Date(from);
  let added = 0;
  while (added < n) {
    t = new Date(t.getTime() + 86_400_000);
    const { isoDay } = localParts(t, timeZone);
    if (isoDay <= 5) added++;
  }
  return t;
}
