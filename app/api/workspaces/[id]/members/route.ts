import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-guard";

const VALID_ROLES = new Set(["admin", "l3_full", "l2_limited", "l1_basic"]);

// Invite (or directly add) a person to the workspace. If a user with that
// email already exists they become a member immediately; otherwise a pending
// invite is stored and auto-claimed the moment they sign up (0002 trigger).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireRole(params.id, "admin");
  if (!caller) return NextResponse.json({ error: "only admins can invite members" }, { status: 403 });

  const { email, role } = await req.json();
  if (!email || !VALID_ROLES.has(role)) {
    return NextResponse.json({ error: "email and a valid role are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existingUser) {
    const { error } = await admin
      .from("workspace_members")
      .upsert({ workspace_id: params.id, user_id: existingUser.id, role });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: true });
  }

  const { error } = await admin.from("workspace_invites").upsert(
    { workspace_id: params.id, email: email.toLowerCase(), role, invited_by: caller.userId },
    { onConflict: "workspace_id,email" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, added: false });
}

// Cancel a pending invite: DELETE /members?invite=<inviteId>
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireRole(params.id, "admin");
  if (!caller) return NextResponse.json({ error: "only admins can manage invites" }, { status: 403 });

  const inviteId = req.nextUrl.searchParams.get("invite");
  if (!inviteId) return NextResponse.json({ error: "invite id required" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId)
    .eq("workspace_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
