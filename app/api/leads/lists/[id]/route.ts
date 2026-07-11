import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/api-guard";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  // Get the list to check workspace_id
  const { data: list } = await supabase
    .from("lead_lists")
    .select("workspace_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!list) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!(await requireMember(list.workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Delete the list
  const { error } = await supabase
    .from("lead_lists")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
