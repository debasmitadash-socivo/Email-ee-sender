import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, verifyToken } from "@/lib/crypto";
import { exchangeGoogleCode, gmailProfile } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  const state = stateRaw ? await verifyToken(stateRaw) : null;
  if (!code || !state?.ws) {
    return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
  }
  // state tokens older than 15 min are rejected
  if (Date.now() - Number(state.t) > 15 * 60_000) {
    return NextResponse.json({ error: "oauth state expired" }, { status: 400 });
  }

  try {
    const redirectUri = `${process.env.APP_URL}/api/oauth/google/callback`;
    const tokens = await exchangeGoogleCode(code, redirectUri);
    if (!tokens.refresh_token) {
      return NextResponse.json(
        { error: "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and reconnect." },
        { status: 400 }
      );
    }
    const profile = await gmailProfile(tokens.access_token);

    const admin = createAdminClient();
    const { error } = await admin.from("mailboxes").upsert(
      {
        workspace_id: state.ws,
        provider: "google",
        email: profile.emailAddress.toLowerCase(),
        refresh_token_enc: await encrypt(tokens.refresh_token),
        access_token_enc: await encrypt(tokens.access_token),
        access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
        status: "active",
        consecutive_failures: 0,
      },
      { onConflict: "workspace_id,email" }
    );
    if (error) throw new Error(error.message);

    return NextResponse.redirect(`${process.env.APP_URL}/w/${state.slug}/mailboxes?connected=google`);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
