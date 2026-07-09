import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceFromBearer } from "@/lib/api-token";

export const dynamic = "force-dynamic";

// GET /api/v1/campaigns — campaigns with basic stats.
export async function GET(req: NextRequest) {
  const ws = await workspaceFromBearer(req.headers.get("authorization"));
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("campaigns")
    .select("id, name, status, created_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false });

  const out = [];
  for (const c of campaigns ?? []) {
    const [{ count: sent }, { data: states }] = await Promise.all([
      admin
        .from("messages")
        .select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true })
        .eq("direction", "outbound")
        .eq("is_seed", false)
        .eq("campaign_leads.campaign_id", c.id),
      admin.from("campaign_leads").select("state").eq("campaign_id", c.id),
    ]);
    const byState: Record<string, number> = {};
    for (const s of states ?? []) byState[s.state] = (byState[s.state] ?? 0) + 1;
    out.push({ ...c, sent: sent ?? 0, leads_by_state: byState });
  }
  return NextResponse.json({ campaigns: out });
}
