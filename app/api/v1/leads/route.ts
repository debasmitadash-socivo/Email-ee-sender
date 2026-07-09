import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceFromBearer } from "@/lib/api-token";

export const dynamic = "force-dynamic";

// POST /api/v1/leads — create leads. Body: { leads: [{email, first_name, ...}], list_name? }
export async function POST(req: NextRequest) {
  const ws = await workspaceFromBearer(req.headers.get("authorization"));
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const leads = Array.isArray(body.leads) ? body.leads : [];
  if (!leads.length) return NextResponse.json({ error: "leads required" }, { status: 400 });

  const admin = createAdminClient();
  let listId: string | null = null;
  if (body.list_name) {
    const { data: list } = await admin
      .from("lead_lists")
      .insert({ workspace_id: ws, name: body.list_name })
      .select()
      .single();
    listId = list?.id ?? null;
  }

  const rows = leads
    // deno-lint / eslint parity: plain filter+map
    .filter((l: { email?: string }) => l.email?.includes("@"))
    .slice(0, 1000)
    .map((l: Record<string, string>) => ({
      workspace_id: ws,
      list_id: listId,
      email: l.email.trim().toLowerCase(),
      first_name: l.first_name || null,
      last_name: l.last_name || null,
      company: l.company || null,
      domain: l.email.trim().toLowerCase().split("@")[1],
      title: l.title || null,
      linkedin_url: l.linkedin_url || null,
      timezone: l.timezone || null,
    }));

  const { data, error } = await admin
    .from("leads")
    .upsert(rows, { onConflict: "workspace_id,email", ignoreDuplicates: true })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: data?.length ?? 0, list_id: listId });
}

// GET /api/v1/leads
export async function GET(req: NextRequest) {
  const ws = await workspaceFromBearer(req.headers.get("authorization"));
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, email, first_name, last_name, company, verify_status, created_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(500);
  return NextResponse.json({ leads: data ?? [] });
}
