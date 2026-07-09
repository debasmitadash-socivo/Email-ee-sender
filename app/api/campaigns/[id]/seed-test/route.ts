import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFromMailbox } from "@/lib/send";
import { leadVars, renderVars, spin, assembleBody } from "@/lib/render";
import { signToken } from "@/lib/crypto";
import type { CampaignSettings, KnowledgeProfile, Lead, Mailbox, SequenceStep } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Seed test (§10): send the rendered sequence step(s) to the workspace's seed
// list. Tagged is_seed so it never counts in analytics.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { step_no = 1 } = await req.json().catch(() => ({}));

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  const settings = (campaign.settings ?? {}) as CampaignSettings;

  const [{ data: steps }, { data: cms }, { data: knowledge }, { data: cls }] = await Promise.all([
    supabase.from("sequence_steps").select("*").eq("campaign_id", params.id).eq("step_no", step_no).eq("variant", "A"),
    supabase.from("campaign_mailboxes").select("mailboxes(*)").eq("campaign_id", params.id).limit(1),
    supabase.from("knowledge").select("profile").eq("workspace_id", campaign.workspace_id).maybeSingle(),
    supabase.from("campaign_leads").select("leads(*)").eq("campaign_id", params.id).limit(1),
  ]);

  const step = (steps?.[0] ?? null) as SequenceStep | null;
  const mailbox = (cms?.[0]?.mailboxes ?? null) as unknown as Mailbox | null;
  const profile = (knowledge?.profile ?? {}) as KnowledgeProfile;
  const seedEmails = profile.seed_emails ?? [];
  const sampleLead = (cls?.[0]?.leads ?? null) as unknown as Lead | null;

  if (!step) return NextResponse.json({ error: `no step ${step_no}` }, { status: 400 });
  if (!mailbox) return NextResponse.json({ error: "no mailbox attached" }, { status: 400 });
  if (!seedEmails.length) {
    return NextResponse.json(
      { error: "No seed emails configured — add seed_emails on the Knowledge page." },
      { status: 400 }
    );
  }

  const vars = sampleLead ? leadVars(sampleLead) : {};
  const subject = `[SEED] ${renderVars(spin(step.subject ?? "Seed test"), vars).rendered}`;
  const bodyRendered = renderVars(spin(step.body), vars).rendered;

  const admin = createAdminClient();
  const results: Record<string, string> = {};
  for (const to of seedEmails.slice(0, 5)) {
    const unsubToken = await signToken({ e: to, w: campaign.workspace_id, cl: "" });
    const assembled = assembleBody({
      body: bodyRendered,
      profile,
      unsubscribeUrl: `https://${process.env.TRACKING_DOMAIN}/u/${unsubToken}`,
      usTargeting: settings.us_targeting,
      plainText: settings.plain_text !== false,
      signatureHtml: mailbox.signature_html,
    });
    try {
      const res = await sendFromMailbox(admin, mailbox, {
        to,
        subject,
        text: assembled.text,
        html: assembled.html,
      });
      await admin.from("messages").insert({
        workspace_id: campaign.workspace_id,
        mailbox_id: mailbox.id,
        direction: "outbound",
        step_no,
        provider_message_id: res.providerMessageId,
        provider_thread_id: res.providerThreadId,
        internet_message_id: res.internetMessageId,
        to_email: to,
        from_email: mailbox.email,
        subject,
        snippet: assembled.text.slice(0, 200),
        is_seed: true,
      });
      results[to] = "sent";
    } catch (err) {
      results[to] = `failed: ${String(err).slice(0, 200)}`;
    }
  }
  return NextResponse.json({ ok: true, results });
}
