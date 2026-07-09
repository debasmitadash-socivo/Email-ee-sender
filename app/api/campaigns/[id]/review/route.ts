import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { leadVars, renderVars, spin, assembleBody } from "@/lib/render";
import { lintEmail } from "@/lib/lint";
import type { CampaignSettings, KnowledgeProfile, Lead, SequenceStep } from "@/lib/types";

export const dynamic = "force-dynamic";

// Review tab: render every step for 10 real randomly-picked leads (§12).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  const settings = (campaign.settings ?? {}) as CampaignSettings;

  const [{ data: steps }, { data: cls }, { data: knowledge }] = await Promise.all([
    supabase.from("sequence_steps").select("*").eq("campaign_id", params.id).order("step_no"),
    supabase.from("campaign_leads").select("lead_id, leads(*), drafts:id").eq("campaign_id", params.id).limit(200),
    supabase.from("knowledge").select("profile").eq("workspace_id", campaign.workspace_id).maybeSingle(),
  ]);
  const profile = (knowledge?.profile ?? {}) as KnowledgeProfile;

  const leads = (cls ?? [])
    .map((r) => r.leads as unknown as Lead)
    .filter(Boolean);
  // random 10
  const picked = leads
    .map((l) => ({ l, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 10)
    .map((x) => x.l);

  const previews = picked.map((lead) => {
    const vars = leadVars(lead);
    const rendered = ((steps ?? []) as SequenceStep[])
      .filter((s) => s.variant === "A")
      .map((s) => {
        const subject = renderVars(spin(s.subject ?? ""), vars).rendered;
        const { rendered: bodyRendered, missing } = renderVars(spin(s.body), vars);
        const assembled = assembleBody({
          body: bodyRendered,
          profile,
          unsubscribeUrl: `https://${process.env.TRACKING_DOMAIN ?? "tracking-domain-not-set"}/u/…`,
          usTargeting: settings.us_targeting,
          plainText: settings.plain_text !== false,
        });
        return {
          step_no: s.step_no,
          subject: s.step_no === 1 ? subject : subject || "(same thread)",
          body: assembled.text,
          missing_vars: missing.filter((m) => !m.startsWith("ai_")),
          ai_slots_pending: missing.filter((m) => m.startsWith("ai_")),
          lint: lintEmail(subject, bodyRendered, profile.banned_phrases ?? []),
        };
      });
    return { lead: { email: lead.email, name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") }, steps: rendered };
  });

  return NextResponse.json({ previews });
}
