import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  // Get lead to check workspace_id
  const { data: lead } = await supabase
    .from("leads")
    .select("workspace_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await requireMember(lead.workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { error } = await supabase
    .from("leads")
    .update(body)
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  // Get lead to check workspace_id
  const { data: lead } = await supabase
    .from("leads")
    .select("workspace_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await requireMember(lead.workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
