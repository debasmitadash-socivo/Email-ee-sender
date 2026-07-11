import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  if (!(await requireMember(params.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Check if requester is admin
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", params.id)
    .eq("user_id", user.user.id)
    .maybeSingle();
  if (member?.role !== "admin") {
    return NextResponse.json({ error: "only admins can manage members" }, { status: 403 });
  }

  const { role } = await req.json();
  if (!role) {
    return NextResponse.json({ error: "role required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .update({ role })
    .eq("id", params.memberId)
    .eq("workspace_id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  if (!(await requireMember(params.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Check if requester is admin
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", params.id)
    .eq("user_id", user.user.id)
    .maybeSingle();
  if (member?.role !== "admin") {
    return NextResponse.json({ error: "only admins can remove members" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .delete()
    .eq("id", params.memberId)
    .eq("workspace_id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
