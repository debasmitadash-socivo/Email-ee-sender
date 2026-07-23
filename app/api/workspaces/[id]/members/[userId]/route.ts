import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-guard";

const VALID_ROLES = new Set(["admin", "l3_full", "l2_limited", "l1_basic"]);

async function isLastAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (target?.role !== "admin") return false;
  const { count } = await admin
    .from("workspace_members")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "admin");
  return (count ?? 0) <= 1;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const caller = await requireRole(params.id, "admin");
  if (!caller) return NextResponse.json({ error: "only admins can manage members" }, { status: 403 });

  const { role } = await req.json();
  if (!VALID_ROLES.has(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

  if (role !== "admin" && (await isLastAdmin(params.id, params.userId))) {
    return NextResponse.json(
      { error: "This is the only admin — promote someone else to admin first." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", params.id)
    .eq("user_id", params.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const caller = await requireRole(params.id, "admin");
  if (!caller) return NextResponse.json({ error: "only admins can remove members" }, { status: 403 });
  if (caller.userId === params.userId) {
    return NextResponse.json({ error: "You can't remove yourself." }, { status: 422 });
  }
  if (await isLastAdmin(params.id, params.userId)) {
    return NextResponse.json(
      { error: "This is the only admin — promote someone else first." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", params.id)
    .eq("user_id", params.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
