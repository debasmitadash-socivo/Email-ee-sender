import "server-only";
import { promises as dns } from "node:dns";
import { SupabaseClient } from "@supabase/supabase-js";
import { runChain, ChainExhaustedError } from "@/lib/providers/run-chain";
import { disposableDomains, roleAccounts } from "@/config/free-domains";
import type { VerifyStatus } from "@/lib/types";

export interface VerifyResult {
  status: VerifyStatus;
  provider: string; // 'layer0' or chain provider
  detail?: string;
}

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Layer-0 verification — free, in-process, always runs before any chain (§7):
 * syntax regex, MX lookup, disposable-domain list, role-account flag.
 * Returns null when layer-0 can't decide (email passes basic checks).
 */
export async function layer0Verify(email: string): Promise<VerifyResult | null> {
  if (!EMAIL_RE.test(email)) return { status: "invalid", provider: "layer0", detail: "syntax" };
  const [local, domain] = email.toLowerCase().split("@");

  if (disposableDomains.has(domain)) {
    return { status: "invalid", provider: "layer0", detail: "disposable domain" };
  }

  let mx: { exchange: string; priority: number }[] = [];
  try {
    mx = await dns.resolveMx(domain);
  } catch {
    return { status: "invalid", provider: "layer0", detail: "no MX records" };
  }
  if (!mx.length) return { status: "invalid", provider: "layer0", detail: "no MX records" };

  if (roleAccounts.has(local)) {
    return { status: "risky", provider: "layer0", detail: "role account" };
  }
  return null; // undecided — hand to the provider chain
}

function mapReoon(status: string): VerifyStatus {
  if (status === "safe" || status === "valid") return "valid";
  if (status === "invalid" || status === "disabled") return "invalid";
  if (status === "catch_all" || status === "role_account" || status === "risky") return "risky";
  return "unknown";
}

function mapMillionVerifier(result: string): VerifyStatus {
  if (result === "ok") return "valid";
  if (result === "invalid" || result === "disposable") return "invalid";
  if (result === "catch_all") return "risky";
  return "unknown";
}

function mapZeroBounce(status: string): VerifyStatus {
  if (status === "valid") return "valid";
  if (status === "invalid" || status === "spamtrap" || status === "abuse") return "invalid";
  if (status === "catch-all" || status === "do_not_mail") return "risky";
  return "unknown";
}

function mapHunter(status: string): VerifyStatus {
  if (status === "valid") return "valid";
  if (status === "invalid") return "invalid";
  if (status === "accept_all" || status === "risky") return "risky";
  return "unknown";
}

/** Full verification: layer-0 then the verify provider chain with failover. */
export async function verifyEmail(admin: SupabaseClient, email: string): Promise<VerifyResult> {
  const l0 = await layer0Verify(email);
  if (l0) return l0;

  try {
    const { result, provider } = await runChain(admin, "verify", async (provider, apiKey) => {
      switch (provider) {
        case "reoon": {
          const url = new URL("https://emailverifier.reoon.com/api/v1/verify");
          url.searchParams.set("email", email);
          url.searchParams.set("key", apiKey);
          url.searchParams.set("mode", "power");
          const res = await fetch(url);
          if (!res.ok) throw new Error(`reoon ${res.status}`);
          const data = await res.json();
          return mapReoon(data.status);
        }
        case "millionverifier": {
          const url = new URL("https://api.millionverifier.com/api/v3/");
          url.searchParams.set("api", apiKey);
          url.searchParams.set("email", email);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`millionverifier ${res.status}`);
          const data = await res.json();
          if (data.error) throw new Error(`millionverifier: ${data.error}`);
          return mapMillionVerifier(data.result);
        }
        case "zerobounce": {
          const url = new URL("https://api.zerobounce.net/v2/validate");
          url.searchParams.set("api_key", apiKey);
          url.searchParams.set("email", email);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`zerobounce ${res.status}`);
          const data = await res.json();
          if (data.error) throw new Error(`zerobounce: ${data.error}`);
          return mapZeroBounce(data.status);
        }
        case "hunter": {
          const url = new URL("https://api.hunter.io/v2/email-verifier");
          url.searchParams.set("email", email);
          url.searchParams.set("api_key", apiKey);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`hunter ${res.status}`);
          const data = await res.json();
          return mapHunter(data.data?.status);
        }
        default:
          throw new Error(`unknown verify provider ${provider}`);
      }
    });
    return { status: result, provider };
  } catch (err) {
    if (err instanceof ChainExhaustedError) {
      // No paid verifier available — layer-0 passed, so mark unknown (usable but unverified)
      return { status: "unknown", provider: "layer0", detail: "chain exhausted" };
    }
    throw err;
  }
}

/** Suppression check: email + domain, workspace + global (§14). */
export async function isSuppressed(
  admin: SupabaseClient,
  workspaceId: string,
  email: string
): Promise<boolean> {
  const domain = email.toLowerCase().split("@")[1];
  const { data } = await admin
    .from("suppression")
    .select("id")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .or(`and(kind.eq.email,value.eq.${email.toLowerCase()}),and(kind.eq.domain,value.eq.${domain})`)
    .limit(1);
  return !!data?.length;
}
