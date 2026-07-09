// Deno twin of /config — keep values in sync with config/*.ts at repo root.
// (Edge functions can't import from the Next.js tree; values are mirrored.)

export const ramp = [
  { week: 1, cap: 8 },
  { week: 2, cap: 15 },
  { week: 3, cap: 25 },
];
export const HARD_MAX_DAILY_CAP = 50;

export function effectiveCap(rampStartedAt: string, dailyCap: number, today = new Date()): number {
  const start = new Date(rampStartedAt);
  const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  const week = Math.floor(Math.max(0, days) / 7) + 1;
  const capped = Math.min(dailyCap, HARD_MAX_DAILY_CAP);
  const entry = ramp.find((r) => r.week === week);
  return entry ? Math.min(entry.cap, capped) : capped;
}

export const JITTER_MIN_S = 120;
export const JITTER_MAX_S = 540;
export const DEFAULT_DAILY_DOMAIN_CAP = 5;
export const COMPLIANCE_HOUR_MIN = 6;
export const COMPLIANCE_HOUR_MAX = 21;
export const BREAKER_TRAILING_SENDS = 50;
export const BREAKER_BOUNCE_RATE = 0.03;
export const BREAKER_MAILBOX_FAILURES = 3;

export type Capability = "ai_write" | "ai_brief" | "ai_classify" | "verify" | "scrape" | "search" | "linkedin";

export interface ChainEntry {
  provider: string;
  envKey: string;
  dailyQuota: number;
}

// NOTE: confirm each provider's current free tier at key signup; these change.
export const chains: Record<Capability, ChainEntry[]> = {
  ai_write: [
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1000 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 },
  ],
  ai_brief: [
    { provider: "anthropic", envKey: "ANTHROPIC_API_KEY", dailyQuota: 500 },
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1000 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 },
  ],
  ai_classify: [
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1000 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 },
  ],
  verify: [
    { provider: "reoon", envKey: "REOON_API_KEY", dailyQuota: 500 },
    { provider: "millionverifier", envKey: "MILLIONVERIFIER_API_KEY", dailyQuota: 200 },
    { provider: "zerobounce", envKey: "ZEROBOUNCE_API_KEY", dailyQuota: 100 },
    { provider: "hunter", envKey: "HUNTER_API_KEY", dailyQuota: 50 },
  ],
  scrape: [
    { provider: "jina", envKey: "JINA_API_KEY", dailyQuota: 500 },
    { provider: "firecrawl", envKey: "FIRECRAWL_API_KEY", dailyQuota: 30 },
  ],
  search: [
    { provider: "serper", envKey: "SERPER_API_KEY", dailyQuota: 80 },
    { provider: "tavily", envKey: "TAVILY_API_KEY", dailyQuota: 30 },
  ],
  linkedin: [{ provider: "apify", envKey: "APIFY_TOKEN", dailyQuota: 20 }],
};

export const MAX_DAILY_FAILURES = 3;

export const aiModels: Record<string, string> = {
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  anthropic: "claude-haiku-4-5-20251001",
};

export const freeDomains = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "live.co.uk", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "protonmail.com", "proton.me", "gmx.com", "gmx.de", "mail.com", "zoho.com",
  "yandex.com", "yandex.ru",
]);

export const spamWords: string[] = [
  "100% free", "act now", "amazing deal", "apply now", "be your own boss", "buy now", "cash bonus",
  "cheap", "click here", "click below", "congratulations", "credit card", "double your",
  "earn extra cash", "exclusive deal", "fast cash", "free access", "free consultation", "free gift",
  "free money", "free trial", "get paid", "guarantee", "guaranteed", "increase sales", "instant",
  "limited time", "make money", "million dollars", "miracle", "no catch", "no cost", "no obligation",
  "no risk", "once in a lifetime", "order now", "prize", "promise you", "pure profit", "risk-free",
  "satisfaction guaranteed", "save big", "special promotion", "this won't last", "urgent", "winner",
  "work from home",
];

export const bannedPhrases: string[] = [
  "i hope this email finds you well", "i came across your profile", "i was impressed by",
  "i couldn't help but notice", "as an ai", "in today's fast-paced world", "cutting-edge",
  "synergy", "revolutionize", "game-changer", "unlock the power",
  "take your business to the next level", "quick question", "just circling back",
  "just checking in", "touching base",
];
