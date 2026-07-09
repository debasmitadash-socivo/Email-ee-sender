import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Click redirect: /r/{token}?to=<url>
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const to = req.nextUrl.searchParams.get("to");
  if (!to || !/^https?:\/\//.test(to)) {
    return NextResponse.json({ error: "invalid target" }, { status: 400 });
  }
  const payload = await verifyToken(params.token);
  if (payload?.w) {
    const admin = createAdminClient();
    await admin.from("events").insert({
      workspace_id: payload.w,
      message_id: payload.m || null,
      campaign_lead_id: payload.cl || null,
      type: "click",
      meta: { to },
    });
  }
  return NextResponse.redirect(to, 302);
}
