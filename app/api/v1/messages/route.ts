import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceFromBearer } from "@/lib/api-token";

export const dynamic = "force-dynamic";

// GET /api/v1/messages?direction=inbound&category=interested
export async function GET(req: NextRequest) {
  const ws = await workspaceFromBearer(req.headers.get("authorization"));
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  let q = admin
    .from("messages")
    .select("id, direction, from_email, to_email, subject, snippet, category, occurred_at")
    .eq("workspace_id", ws)
    .eq("is_internal", false)
    .order("occurred_at", { ascending: false })
    .limit(200);
  const direction = req.nextUrl.searchParams.get("direction");
  const category = req.nextUrl.searchParams.get("category");
  if (direction) q = q.eq("direction", direction);
  if (category) q = q.eq("category", category);

  const { data } = await q;
  return NextResponse.json({ messages: data ?? [] });
}
