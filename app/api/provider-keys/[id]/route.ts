import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ws = req.nextUrl.searchParams.get("workspace");
  if (!ws || !(await requireMember(ws))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = createAdminClient();
  const { error } = await admin.from("provider_keys").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// clear a key's "exhausted today" flag manually (e.g. after upgrading a plan)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ws = req.nextUrl.searchParams.get("workspace");
  if (!ws || !(await requireMember(ws))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (body.reset_exhausted) update.exhausted_date = null;
  if (typeof body.active === "boolean") update.active = body.active;
  if (!Object.keys(update).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const { error } = await admin.from("provider_keys").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
