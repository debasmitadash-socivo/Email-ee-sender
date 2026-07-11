import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/api-guard";

export async function POST(req: NextRequest) {
  const { workspace_id, name } = await req.json();
  if (!(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("lead_lists")
    .insert({ workspace_id, name: name.trim() });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
