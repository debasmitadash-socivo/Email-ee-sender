// Default warm-up ramp per mailbox age (weeks since ramp_started_at).
// wk4+ uses the mailbox's own daily_cap. HARD_MAX is absolute — the UI
// slider cannot exceed it and the tick re-checks it at send time.
export const ramp: { week: number; cap: number }[] = [
  { week: 1, cap: 8 },
  { week: 2, cap: 15 },
  { week: 3, cap: 25 },
];

export const HARD_MAX_DAILY_CAP = 50;
export const DEFAULT_DAILY_CAP = 40;

/** Effective daily cap for a mailbox given its ramp start date. */
export function effectiveCap(rampStartedAt: string | Date, dailyCap: number, today: Date = new Date()): number {
  const start = new Date(rampStartedAt);
  const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  const week = Math.floor(Math.max(0, days) / 7) + 1;
  const capped = Math.min(dailyCap, HARD_MAX_DAILY_CAP);
  const entry = ramp.find((r) => r.week === week);
  return entry ? Math.min(entry.cap, capped) : capped;
}

// Jitter added to every scheduled send, seconds (build brief: 120–540s)
export const JITTER_MIN_S = 120;
export const JITTER_MAX_S = 540;

// Per-recipient-domain daily cap per campaign (default; per-campaign override in settings)
export const DEFAULT_DAILY_DOMAIN_CAP = 5;

// Absolute lead-local send hours — no send outside these regardless of window settings (§14)
export const COMPLIANCE_HOUR_MIN = 6; // 06:00
export const COMPLIANCE_HOUR_MAX = 21; // 21:00

// Trailing-send window and bounce-rate threshold for the campaign breaker
export const BREAKER_TRAILING_SENDS = 50;
export const BREAKER_BOUNCE_RATE = 0.03;
export const BREAKER_MAILBOX_FAILURES = 3;
