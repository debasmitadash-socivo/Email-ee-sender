import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HARD_MAX_DAILY_CAP } from "@/config/ramp";

export const dynamic = "force-dynamic";

// PATCH: update cap / status / display_name / signature. RLS-scoped — a
// non-member's update simply matches zero rows.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const body = await req.json();
  const update: Record<string, unknown> = {};
  if (typeof body.daily_cap === "number") {
    update.daily_cap = Math.max(1, Math.min(HARD_MAX_DAILY_CAP, Math.round(body.daily_cap)));
  }
  if (body.status === "active" || body.status === "paused") update.status = body.status;
  if (typeof body.display_name === "string") update.display_name = body.display_name;
  if (typeof body.signature_html === "string") update.signature_html = body.signature_html;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("mailboxes")
    .update(update)
    .eq("id", params.id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("mailboxes").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
