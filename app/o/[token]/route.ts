import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// Open-tracking pixel: /o/{token}.gif
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const raw = params.token.replace(/\.gif$/, "");
  const payload = await verifyToken(raw);
  if (payload?.w) {
    const admin = createAdminClient();
    await admin.from("events").insert({
      workspace_id: payload.w,
      message_id: payload.m || null,
      campaign_lead_id: payload.cl || null,
      type: "open",
      meta: {},
    });
  }
  return new NextResponse(GIF as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
