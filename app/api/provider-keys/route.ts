import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";
import { encrypt } from "@/lib/crypto";
import { addableProviders } from "@/config/providers";

export const dynamic = "force-dynamic";

// Keys are a global vault (service-role only). Any workspace member can manage
// them for the pilot; membership of the requesting workspace is the auth check.
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("workspace");
  if (!ws || !(await requireMember(ws))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("provider_keys")
    .select("id, provider, label, active, exhausted_date, created_at")
    .order("provider")
    .order("created_at");
  // never return the key material itself
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { workspace_id, provider, label, key } = await req.json();
  if (!workspace_id || !(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!provider || !key || typeof key !== "string" || key.trim().length < 8) {
    return NextResponse.json({ error: "provider and a valid key are required" }, { status: 400 });
  }
  if (!addableProviders.some((p) => p.provider === provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("provider_keys").insert({
    provider,
    label: label?.slice(0, 60) || null,
    key_enc: await encrypt(key.trim()),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
