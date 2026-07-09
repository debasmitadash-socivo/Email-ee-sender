// Provider chain configuration. Order = priority. Edit here, never at call sites.
// NOTE: confirm each provider's current free tier at key signup; these change.
// dailyQuota is a conservative in-house ceiling, not the provider's official number.

export type Capability =
  | "ai_write"
  | "ai_brief"
  | "ai_classify"
  | "verify"
  | "scrape"
  | "search"
  | "linkedin";

export interface ChainEntry {
  provider: string;
  envKey: string; // env var holding the API key; entry is skipped if absent
  dailyQuota: number; // in-house per-day ceiling; chain skips past it
}

export const chains: Record<Capability, ChainEntry[]> = {
  ai_write: [
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1000 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 },
  ],
  ai_brief: [
    // Anthropic first when the key is present — briefs only, per build brief §9.1
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
    // layer-0 (syntax/MX/disposable/role/catch-all) always runs first, in-process, free
    { provider: "reoon", envKey: "REOON_API_KEY", dailyQuota: 500 },
    { provider: "millionverifier", envKey: "MILLIONVERIFIER_API_KEY", dailyQuota: 200 },
    { provider: "zerobounce", envKey: "ZEROBOUNCE_API_KEY", dailyQuota: 100 },
    { provider: "hunter", envKey: "HUNTER_API_KEY", dailyQuota: 50 },
  ],
  scrape: [
    // self-hosted fetch runs first, in-process, free
    { provider: "jina", envKey: "JINA_API_KEY", dailyQuota: 500 },
    { provider: "firecrawl", envKey: "FIRECRAWL_API_KEY", dailyQuota: 30 },
  ],
  search: [
    { provider: "serper", envKey: "SERPER_API_KEY", dailyQuota: 80 },
    { provider: "tavily", envKey: "TAVILY_API_KEY", dailyQuota: 30 },
  ],
  linkedin: [
    // only runs when campaign linkedin_enrichment=true AND token present AND under quota
    { provider: "apify", envKey: "APIFY_TOKEN", dailyQuota: 20 },
  ],
};

// After this many errors in a day a provider is benched until tomorrow.
export const MAX_DAILY_FAILURES = 3;

// AI model per provider (free-tier models)
export const aiModels: Record<string, string> = {
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  anthropic: "claude-haiku-4-5-20251001",
};
