import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/api-guard";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
    return NextResponse.json({ error: "only admins can invite members" }, { status: 403 });
  }

  const { email, role } = await req.json();
  if (!email || !role) {
    return NextResponse.json({ error: "email and role required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Find or create user by email (sign up via invite link in practice)
  const { data: invitee } = await admin.auth.admin.getUsersByEmail(email);
  if (!invitee || invitee.length === 0) {
    return NextResponse.json(
      { error: "User does not exist. They must sign up first." },
      { status: 422 }
    );
  }

  const inviteeId = invitee[0].id;

  // Check if already a member
  const { data: existing } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", params.id)
    .eq("user_id", inviteeId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "User is already a member" }, { status: 422 });
  }

  // Create workspace membership
  const { error } = await admin
    .from("workspace_members")
    .insert({
      workspace_id: params.id,
      user_id: inviteeId,
      role,
      invited_by: user.user.id,
      accepted_at: new Date().toISOString(), // Auto-accept for now (in practice: email invite)
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
