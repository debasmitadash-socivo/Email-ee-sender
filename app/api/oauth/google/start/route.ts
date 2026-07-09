import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signToken } from "@/lib/crypto";
import { googleAuthUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  if (!workspaceId) return NextResponse.json({ error: "workspace required" }, { status: 400 });
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 501 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_URL));

  // RLS: this returns a row only if the user is a member
  const { data: ws } = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!ws) return NextResponse.json({ error: "not a workspace member" }, { status: 403 });

  const state = await signToken({ ws: workspaceId, slug, u: user.id, t: String(Date.now()) });
  const redirectUri = `${process.env.APP_URL}/api/oauth/google/callback`;
  return NextResponse.redirect(googleAuthUrl(redirectUri, state));
}
