import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeNextSendAt } from "@/lib/schedule";
import type { CampaignSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

// Approve / reject / edit a draft. On approve, the campaign_lead is scheduled.
// On reject, the lead goes back to researching so the writer regenerates.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const body = (await req.json()) as {
    action: "approve" | "reject";
    edited_subject?: string;
    edited_body?: string;
  };

  // RLS scopes drafts through campaign membership
  const { data: draft } = await supabase
    .from("drafts")
    .select("*, campaign_leads(*, campaigns(*), leads(timezone, email))")
    .eq("id", params.id)
    .maybeSingle();
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cl = draft.campaign_leads as {
    id: string;
    approved_count: number;
    campaigns: { settings: CampaignSettings };
    leads: { timezone: string | null };
  };

  if (body.action === "reject") {
    await supabase.from("drafts").update({ status: "rejected" }).eq("id", params.id);
    await supabase.from("campaign_leads").update({ state: "researching" }).eq("id", cl.id);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // approve (with optional inline edits)
  const { error } = await supabase
    .from("drafts")
    .update({
      status: "approved",
      edited_subject: body.edited_subject ?? null,
      edited_body: body.edited_body ?? null,
    })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settings = cl.campaigns?.settings ?? {};
  const tz =
    settings.timezone_mode === "lead"
      ? (cl.leads?.timezone ?? settings.fixed_tz ?? "Europe/London")
      : (settings.fixed_tz ?? "Europe/London");
  const next = computeNextSendAt({
    base: new Date(),
    delayDays: 0,
    window: settings.send_window ?? { start: "08:30", end: "17:30", days: [1, 2, 3, 4, 5] },
    timeZone: tz,
  });
  await supabase
    .from("campaign_leads")
    .update({
      state: "scheduled",
      next_send_at: next.toISOString(),
      approved_count: (cl.approved_count ?? 0) + 1,
    })
    .eq("id", cl.id);

  return NextResponse.json({ ok: true, status: "approved", next_send_at: next.toISOString() });
}
