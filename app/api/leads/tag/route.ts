import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Bulk add/remove tags on selected leads. RLS-scoped: only the caller's
// workspace leads are visible/updatable.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const body = (await req.json()) as {
    lead_ids: string[];
    add?: string[];
    remove?: string[];
  };
  if (!Array.isArray(body.lead_ids) || !body.lead_ids.length) {
    return NextResponse.json({ error: "lead_ids required" }, { status: 400 });
  }
  const add = (body.add ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const remove = new Set((body.remove ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (!add.length && !remove.size) return NextResponse.json({ error: "nothing to change" }, { status: 400 });

  const { data: leads, error } = await supabase.from("leads").select("id, tags").in("id", body.lead_ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  for (const lead of leads ?? []) {
    const current: string[] = lead.tags ?? [];
    const next = Array.from(new Set([...current, ...add])).filter((t) => !remove.has(t));
    const { error: upErr } = await supabase.from("leads").update({ tags: next }).eq("id", lead.id);
    if (!upErr) updated++;
  }
  return NextResponse.json({ updated });
}
