import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Honour an unsubscribe instantly: global suppression + stop any active
// sequences for that email + event + notification queue entry (§8, §14).
export async function POST(req: NextRequest) {
  const { token } = await req.json();
  const payload = token ? await verifyToken(token) : null;
  if (!payload?.e || !payload.w) return NextResponse.json({ error: "invalid token" }, { status: 400 });

  const admin = createAdminClient();
  const email = payload.e.toLowerCase();

  // global suppression (null workspace) so no client workspace ever emails them again
  await admin
    .from("suppression")
    .upsert(
      { workspace_id: null, value: email, kind: "email", reason: "unsubscribed" },
      { onConflict: "workspace_id,value,kind", ignoreDuplicates: true }
    );

  // stop all active sequences to this email in the workspace
  const { data: leads } = await admin.from("leads").select("id").eq("email", email);
  if (leads?.length) {
    await admin
      .from("campaign_leads")
      .update({ state: "unsubscribed", next_send_at: null, stop_reason: "unsubscribed" })
      .in("lead_id", leads.map((l) => l.id))
      .in("state", ["queued", "researching", "drafted", "awaiting_approval", "approved", "scheduled", "in_sequence"]);
  }

  await admin.from("events").insert({
    workspace_id: payload.w,
    campaign_lead_id: payload.cl || null,
    type: "unsubscribe",
    meta: { email },
  });
  await admin.from("notification_queue").insert({
    workspace_id: payload.w,
    event: "unsubscribe",
    payload: { email },
  });

  return NextResponse.json({ ok: true });
}
