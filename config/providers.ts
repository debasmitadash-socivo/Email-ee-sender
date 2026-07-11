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

// Catalog for the in-app key vault UI: which providers a user can add keys
// for, what they power, and where to get a free key. Order = display order.
export interface AddableProvider {
  provider: string;
  name: string;
  powers: string; // human description of the capability
  free: string; // free-tier note
  signupUrl: string;
}

export const addableProviders: AddableProvider[] = [
  { provider: "gemini", name: "Google Gemini", powers: "AI writing, research briefs, reply scoring", free: "Generous free tier — best first key to add", signupUrl: "https://aistudio.google.com/app/apikey" },
  { provider: "groq", name: "Groq", powers: "AI writing & classification (fast fallback)", free: "Free tier", signupUrl: "https://console.groq.com/keys" },
  { provider: "openrouter", name: "OpenRouter", powers: "AI writing (free models)", free: "Free models available", signupUrl: "https://openrouter.ai/keys" },
  { provider: "anthropic", name: "Anthropic (Claude)", powers: "Research briefs only (highest quality)", free: "Paid — optional", signupUrl: "https://console.anthropic.com/settings/keys" },
  { provider: "reoon", name: "Reoon", powers: "Email verification", free: "Free credits", signupUrl: "https://emailverifier.reoon.com" },
  { provider: "millionverifier", name: "MillionVerifier", powers: "Email verification", free: "Free credits", signupUrl: "https://app.millionverifier.com" },
  { provider: "zerobounce", name: "ZeroBounce", powers: "Email verification", free: "Free monthly credits", signupUrl: "https://www.zerobounce.net" },
  { provider: "hunter", name: "Hunter", powers: "Email verification", free: "Free monthly credits", signupUrl: "https://hunter.io/api-keys" },
  { provider: "serper", name: "Serper", powers: "Google + news search for research", free: "Free credits", signupUrl: "https://serper.dev/api-key" },
  { provider: "firecrawl", name: "Firecrawl", powers: "Website scraping for research", free: "Free credits", signupUrl: "https://www.firecrawl.dev/app/api-keys" },
  { provider: "tavily", name: "Tavily", powers: "Search fallback for research", free: "Free credits", signupUrl: "https://app.tavily.com" },
  { provider: "jina", name: "Jina Reader", powers: "Website reading (works keyless; key raises limits)", free: "Optional", signupUrl: "https://jina.ai/reader" },
  { provider: "apify", name: "Apify", powers: "LinkedIn enrichment (optional toggle)", free: "Free monthly credits", signupUrl: "https://console.apify.com/account/integrations" },
];

// error looks like a hit-the-daily-limit / rate-limit signal → mark the key done for today
export function isQuotaError(err: unknown): boolean {
  return /\b(429|402|quota|rate.?limit|resource.?exhausted|too many requests|insufficient|limit reached|exhaust)\b/i.test(
    String(err)
  );
}

// AI model per provider (free-tier models)
export const aiModels: Record<string, string> = {
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  anthropic: "claude-haiku-4-5-20251001",
};
