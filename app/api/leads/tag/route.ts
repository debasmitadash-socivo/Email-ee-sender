import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Bulk actions on selected leads: add/remove tags, or move them into a list
// (existing or newly created). RLS-scoped: only the caller's workspace leads
// are visible/updatable.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const body = (await req.json()) as {
    lead_ids: string[];
    add?: string[];
    remove?: string[];
    list_id?: string;
    new_list_name?: string;
    workspace_id?: string;
  };
  if (!Array.isArray(body.lead_ids) || !body.lead_ids.length) {
    return NextResponse.json({ error: "lead_ids required" }, { status: 400 });
  }
  const add = (body.add ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const remove = new Set((body.remove ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));

  // list assignment (create the list first if a new name was given)
  let listId = body.list_id ?? null;
  if (!listId && body.new_list_name && body.workspace_id) {
    const { data: list, error } = await supabase
      .from("lead_lists")
      .insert({ workspace_id: body.workspace_id, name: body.new_list_name.slice(0, 80) })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    listId = list.id;
  }

  if (!add.length && !remove.size && !listId) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  const { data: leads, error } = await supabase.from("leads").select("id, tags").in("id", body.lead_ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  for (const lead of leads ?? []) {
    const current: string[] = lead.tags ?? [];
    const update: Record<string, unknown> = {};
    if (add.length || remove.size) {
      update.tags = Array.from(new Set([...current, ...add])).filter((t) => !remove.has(t));
    }
    if (listId) update.list_id = listId;
    const { error: upErr } = await supabase.from("leads").update(update).eq("id", lead.id);
    if (!upErr) updated++;
  }
  return NextResponse.json({ updated, list_id: listId });
}
