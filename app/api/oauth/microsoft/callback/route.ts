import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, verifyToken } from "@/lib/crypto";
import { exchangeMsCode, graphMe } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const state = stateRaw ? await verifyToken(stateRaw) : null;
  if (!code || !state?.ws) {
    return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
  }
  if (Date.now() - Number(state.t) > 15 * 60_000) {
    return NextResponse.json({ error: "oauth state expired" }, { status: 400 });
  }

  try {
    const redirectUri = `${process.env.APP_URL}/api/oauth/microsoft/callback`;
    const tokens = await exchangeMsCode(code, redirectUri);
    if (!tokens.refresh_token) {
      return NextResponse.json({ error: "Microsoft did not return a refresh token" }, { status: 400 });
    }
    const me = await graphMe(tokens.access_token);
    const email = (me.mail ?? me.userPrincipalName).toLowerCase();

    const admin = createAdminClient();
    const { error } = await admin.from("mailboxes").upsert(
      {
        workspace_id: state.ws,
        provider: "microsoft",
        email,
        display_name: me.displayName ?? null,
        refresh_token_enc: await encrypt(tokens.refresh_token),
        access_token_enc: await encrypt(tokens.access_token),
        access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
        status: "active",
        consecutive_failures: 0,
      },
      { onConflict: "workspace_id,email" }
    );
    if (error) throw new Error(error.message);

    return NextResponse.redirect(`${process.env.APP_URL}/w/${state.slug}/mailboxes?connected=microsoft`);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
