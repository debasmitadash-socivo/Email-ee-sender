import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { chains, MAX_DAILY_FAILURES, type Capability } from "@/config/providers";

// Generic provider chain runner (build brief §7). Never hardcode a provider
// at a call site — always go through runChain. The tick engine has a Deno
// twin of this in supabase/functions/_shared/run-chain.ts; keep behaviour in sync.

export class ChainExhaustedError extends Error {
  constructor(public capability: Capability) {
    super(`Provider chain exhausted for capability: ${capability}`);
  }
}

async function getUsage(
  admin: SupabaseClient,
  provider: string,
  capability: string
): Promise<{ used: number; failed: number }> {
  const { data } = await admin
    .from("provider_usage")
    .select("used, failed")
    .eq("provider", provider)
    .eq("capability", capability)
    .eq("day", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  return data ?? { used: 0, failed: 0 };
}

async function bumpUsage(
  admin: SupabaseClient,
  provider: string,
  capability: string,
  field: "used" | "failed"
) {
  const day = new Date().toISOString().slice(0, 10);
  const current = await getUsage(admin, provider, capability);
  await admin.from("provider_usage").upsert(
    {
      provider,
      capability,
      day,
      used: current.used + (field === "used" ? 1 : 0),
      failed: current.failed + (field === "failed" ? 1 : 0),
    },
    { onConflict: "provider,capability,day" }
  );
}

/**
 * Run `task` against the first available provider in the capability's chain.
 * Skips providers with no key, over quota, or ≥MAX_DAILY_FAILURES errors today.
 * On 429/402/5xx-style failures (any throw), logs and fails over to the next.
 */
export async function runChain<T>(
  admin: SupabaseClient,
  capability: Capability,
  task: (provider: string, apiKey: string) => Promise<T>
): Promise<{ result: T; provider: string }> {
  const chain = chains[capability];
  const attempts: string[] = [];

  for (const entry of chain) {
    const apiKey = process.env[entry.envKey];
    if (!apiKey) continue;

    const usage = await getUsage(admin, entry.provider, capability);
    if (usage.used >= entry.dailyQuota) {
      attempts.push(`${entry.provider}: over quota (${usage.used}/${entry.dailyQuota})`);
      continue;
    }
    if (usage.failed >= MAX_DAILY_FAILURES) {
      attempts.push(`${entry.provider}: benched (${usage.failed} failures today)`);
      continue;
    }

    try {
      const result = await task(entry.provider, apiKey);
      await bumpUsage(admin, entry.provider, capability, "used");
      return { result, provider: entry.provider };
    } catch (err) {
      attempts.push(`${entry.provider}: ${String(err).slice(0, 200)}`);
      await bumpUsage(admin, entry.provider, capability, "failed");
      continue;
    }
  }

  console.error(`[runChain] ${capability} exhausted:`, attempts);
  throw new ChainExhaustedError(capability);
}
