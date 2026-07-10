import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Create a workspace + the creator's admin membership.
// Done server-side with the service role after verifying the session, because
// the bootstrap is a chicken-and-egg for RLS: you can't be a member of a
// workspace that doesn't exist yet. The session check is what authorises it.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { name } = await req.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Ensure the public.users row exists (belt-and-braces in case the signup
  // trigger didn't fire — e.g. the user was confirmed manually via SQL).
  await admin.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      name: (user.user_metadata?.name as string) ?? user.email?.split("@")[0] ?? "User",
    },
    { onConflict: "id" }
  );

  let slug = slugify(name) || `ws-${Date.now().toString(36)}`;
  const { data: clash } = await admin.from("workspaces").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const { data: ws, error: wsErr } = await admin
    .from("workspaces")
    .insert({ name: name.trim(), slug })
    .select()
    .single();
  if (wsErr || !ws) {
    return NextResponse.json({ error: wsErr?.message ?? "could not create workspace" }, { status: 500 });
  }

  const { error: memErr } = await admin
    .from("workspace_members")
    .insert({ workspace_id: ws.id, user_id: user.id, role: "admin" });
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, slug });
}
