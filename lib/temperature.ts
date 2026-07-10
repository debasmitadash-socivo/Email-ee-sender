// Lead temperature — a simple 4-bucket read derived from existing state +
// reply categories. Computed, never stored; the raw states stay the source
// of truth.
import type { ClState, ReplyCategory } from "@/lib/types";

export type Temperature = "warm" | "cold" | "neutral" | "rejected";

/** Derive temperature from a campaign_lead state (+ last reply category when known). */
export function temperatureOf(state: ClState, lastCategory?: ReplyCategory | null): Temperature {
  if (state === "positive") return "warm";
  if (state === "bounced" || state === "unsubscribed" || state === "failed") return "rejected";
  if (state === "replied") {
    if (lastCategory === "interested" || lastCategory === "info_request") return "warm";
    if (lastCategory === "not_interested") return "rejected";
    return "neutral"; // not_now, ooo, wrong_person, other
  }
  if (state === "paused") return "neutral";
  // queued/researching/drafted/awaiting_approval/approved/scheduled/in_sequence/finished
  return "cold";
}

export const temperatureMeta: Record<Temperature, { label: string; tone: "success" | "secondary" | "warn" | "danger" }> = {
  warm: { label: "Warm", tone: "success" },
  cold: { label: "Cold", tone: "secondary" },
  neutral: { label: "Neutral", tone: "warn" },
  rejected: { label: "Rejected", tone: "danger" },
};

/** Inbox filter: reply categories belonging to each temperature bucket. */
export const temperatureCategories: Record<Temperature, ReplyCategory[]> = {
  warm: ["interested", "info_request"],
  neutral: ["not_now", "ooo", "wrong_person", "other"],
  rejected: ["not_interested", "bounce", "unsubscribe"],
  cold: [], // cold = no reply yet, so it never appears as an inbound category
};
