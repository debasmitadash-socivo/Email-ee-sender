import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";
import { verifyEmail } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verify a batch of unverified leads (≤20/call; the client loops until done).
export async function POST(req: NextRequest) {
  const { workspace_id, list_id } = await req.json();
  if (!workspace_id) return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
  if (!(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  let query = admin
    .from("leads")
    .select("id, email")
    .eq("workspace_id", workspace_id)
    .eq("verify_status", "unverified")
    .limit(20);
  if (list_id) query = query.eq("list_id", list_id);
  const { data: leads, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let verified = 0;
  for (const lead of leads ?? []) {
    try {
      const result = await verifyEmail(admin, lead.email);
      await admin
        .from("leads")
        .update({ verify_status: result.status, verify_provider: result.provider })
        .eq("id", lead.id);
      verified++;
    } catch (err) {
      console.error(`verify failed for ${lead.email}:`, err);
    }
  }

  const { count: remaining } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace_id)
    .eq("verify_status", "unverified");

  return NextResponse.json({ verified, remaining: remaining ?? 0 });
}
