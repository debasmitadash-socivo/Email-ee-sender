// Startup env verification. Never invent credentials: read .env, verify what
// is required, fail with a clear list of what's missing. Optional providers
// degrade gracefully.

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "ENCRYPTION_KEY",
] as const;

const OPTIONAL_GROUPS: Record<string, string[]> = {
  "Google mailboxes": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  "Microsoft mailboxes": ["MS_CLIENT_ID", "MS_CLIENT_SECRET"],
  Tracking: ["TRACKING_DOMAIN"],
  "AI writing": ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"],
  Verification: ["REOON_API_KEY", "MILLIONVERIFIER_API_KEY", "ZEROBOUNCE_API_KEY", "HUNTER_API_KEY"],
  Research: ["SERPER_API_KEY", "FIRECRAWL_API_KEY", "TAVILY_API_KEY", "JINA_API_KEY"],
  LinkedIn: ["APIFY_TOKEN"],
  Telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  n8n: ["N8N_WEBHOOK_URL"],
};

export function checkEnv(): { ok: boolean; missing: string[]; degraded: string[] } {
  const missing: string[] = REQUIRED.filter((k) => !process.env[k]);
  if (process.env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
    missing.push("ENCRYPTION_KEY (must be 64 hex chars — openssl rand -hex 32)");
  }
  const degraded = Object.entries(OPTIONAL_GROUPS)
    .filter(([, keys]) => keys.every((k) => !process.env[k]))
    .map(([group]) => group);
  return { ok: missing.length === 0, missing, degraded };
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable: ${key}`);
  return v;
}
