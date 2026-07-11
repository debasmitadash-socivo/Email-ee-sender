import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { chains, isQuotaError, type Capability } from "@/config/providers";
import { decrypt } from "@/lib/crypto";

// Generic provider chain runner (build brief §7) with an in-app key vault.
// For each provider in a capability's chain, candidate keys are:
//   1. every active DB key for that provider not exhausted today (stack free
//      tiers to multiply quota), ordered by priority, then
//   2. the environment variable key as a final fallback.
// On a hit-the-daily-limit error, that specific key is marked exhausted for
// the day (and the operator is notified once), and we rotate to the next key.
// The Deno twin lives in supabase/functions/_shared/providers.ts — keep in sync.

export class ChainExhaustedError extends Error {
  constructor(public capability: Capability) {
    super(`Provider chain exhausted for capability: ${capability}`);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

interface Candidate {
  key: string;
  source: "db" | "env";
  id?: string;
}

async function candidatesFor(admin: SupabaseClient, provider: string, envKey?: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const { data: rows } = await admin
    .from("provider_keys")
    .select("id, key_enc, exhausted_date, priority")
    .eq("provider", provider)
    .eq("active", true)
    .order("priority");
  for (const r of rows ?? []) {
    if (r.exhausted_date === today()) continue;
    try {
      out.push({ key: await decrypt(r.key_enc), source: "db", id: r.id });
    } catch {
      /* undecryptable key — skip */
    }
  }
  if (envKey) out.push({ key: envKey, source: "env" });
  return out;
}

async function markExhausted(admin: SupabaseClient, provider: string, cand: Candidate) {
  if (cand.source === "db" && cand.id) {
    await admin.from("provider_keys").update({ exhausted_date: today() }).eq("id", cand.id);
  }
  // notify operator once/day that this provider hit its free ceiling
  const { error } = await admin.from("alert_log").insert({ key: `keyexhausted:${provider}`, day: today() });
  if (!error) {
    const { data: workspaces } = await admin.from("workspaces").select("id");
    for (const ws of workspaces ?? []) {
      await admin.from("notification_queue").insert({
        workspace_id: ws.id,
        event: "provider_quota_exhausted",
        payload: { provider, note: `${provider} hit its free daily limit — rotated to the next available key/provider.` },
      });
    }
  }
}

async function bumpUsage(admin: SupabaseClient, provider: string, capability: string, field: "used" | "failed") {
  const day = today();
  const { data } = await admin
    .from("provider_usage")
    .select("used, failed")
    .eq("provider", provider)
    .eq("capability", capability)
    .eq("day", day)
    .maybeSingle();
  const cur = data ?? { used: 0, failed: 0 };
  await admin.from("provider_usage").upsert(
    { provider, capability, day, used: cur.used + (field === "used" ? 1 : 0), failed: cur.failed + (field === "failed" ? 1 : 0) },
    { onConflict: "provider,capability,day" }
  );
}

export async function runChain<T>(
  admin: SupabaseClient,
  capability: Capability,
  task: (provider: string, apiKey: string) => Promise<T>
): Promise<{ result: T; provider: string }> {
  const attempts: string[] = [];

  for (const entry of chains[capability]) {
    const envKey = process.env[entry.envKey];
    const candidates = await candidatesFor(admin, entry.provider, envKey);
    if (!candidates.length) continue;

    for (const cand of candidates) {
      try {
        const result = await task(entry.provider, cand.key);
        await bumpUsage(admin, entry.provider, capability, "used");
        return { result, provider: entry.provider };
      } catch (err) {
        attempts.push(`${entry.provider}(${cand.source}): ${String(err).slice(0, 120)}`);
        await bumpUsage(admin, entry.provider, capability, "failed");
        if (isQuotaError(err)) await markExhausted(admin, entry.provider, cand);
        // try the next candidate/provider
      }
    }
  }

  console.error(`[runChain] ${capability} exhausted:`, attempts);
  throw new ChainExhaustedError(capability);
}
