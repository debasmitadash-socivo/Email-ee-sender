import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkDns } from "@/lib/dns";
import { computeNextSendAt, DEFAULT_WINDOW, jitterSeconds } from "@/lib/schedule";
import type { CampaignSettings, Mailbox, SequenceStep } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Launch gate (§10, blocking) then schedule/queue the audience.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { force_dns } = await req.json().catch(() => ({ force_dns: false }));

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  const settings = (campaign.settings ?? {}) as CampaignSettings;

  const [{ data: steps }, { data: cms }, { count: audience }] = await Promise.all([
    supabase.from("sequence_steps").select("*").eq("campaign_id", params.id).order("step_no"),
    supabase.from("campaign_mailboxes").select("mailbox_id, mailboxes(*)").eq("campaign_id", params.id),
    supabase
      .from("campaign_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", params.id),
  ]);

  const failures: string[] = [];
  const stepList = (steps ?? []) as SequenceStep[];
  const mailboxes = (cms ?? [])
    .map((r) => r.mailboxes as unknown as Mailbox)
    .filter(Boolean);

  // ── Launch gate ──────────────────────────────────────────────────────────
  if (!stepList.length) failures.push("Add at least one sequence step.");
  const step1 = stepList.filter((s) => s.step_no === 1);
  if (step1.length && step1.some((s) => !s.subject?.trim()))
    failures.push("Step 1 must have a subject (each variant).");
  if (stepList.length && !step1.length) failures.push("The sequence must start at step 1.");

  if (!mailboxes.length) failures.push("Attach at least one mailbox.");
  for (const m of mailboxes) {
    if (m.status !== "active") failures.push(`Mailbox ${m.email} is ${m.status} — reconnect or resume it.`);
  }

  if (!process.env.TRACKING_DOMAIN)
    failures.push("TRACKING_DOMAIN is not configured — unsubscribe links cannot be generated.");

  const window = { ...DEFAULT_WINDOW, ...(settings.send_window ?? {}) };
  const [sh, sm] = window.start.split(":").map(Number);
  const [eh, em] = window.end.split(":").map(Number);
  if (sh * 60 + sm >= eh * 60 + em) failures.push("Send window start must be before end.");
  if (!window.days?.length) failures.push("Send window needs at least one weekday.");

  if (!audience) failures.push("Audience is empty — add leads.");

  // Live DNS pass per sending domain (SPF includes provider, DKIM selector present, DMARC exists)
  const dnsResults: Record<string, unknown> = {};
  if (!force_dns) {
    const domains = new Map<string, Mailbox>();
    for (const m of mailboxes) domains.set(m.email.split("@")[1], m);
    for (const [domain, m] of domains) {
      const dns = await checkDns(domain, m.provider);
      dnsResults[domain] = dns;
      if (!dns.spf.pass) failures.push(`SPF fails for ${domain}: ${dns.spf.fix}`);
      if (!dns.dkim.pass) failures.push(`DKIM fails for ${domain}: ${dns.dkim.fix}`);
      if (!dns.dmarc.pass) failures.push(`DMARC fails for ${domain}: ${dns.dmarc.fix}`);
    }
  }

  if (failures.length) return NextResponse.json({ ok: false, failures, dns: dnsResults }, { status: 422 });

  // ── Schedule / queue ─────────────────────────────────────────────────────
  const { data: cls } = await supabase
    .from("campaign_leads")
    .select("id, lead_id, state, leads(timezone)")
    .eq("campaign_id", params.id)
    .in("state", ["queued", "paused"]);

  const usesAi = stepList.some((s) => /\{\{\s*ai_[a-zA-Z0-9_]+\s*\}\}/.test(`${s.subject ?? ""} ${s.body}`));
  const variants = [...new Set(stepList.filter((s) => s.step_no === 1).map((s) => s.variant))].sort();
  const mailboxIds = mailboxes.map((m) => m.id);
  const now = new Date();
  const perMailboxOffset: Record<string, number> = {};

  let i = 0;
  for (const cl of cls ?? []) {
    const mailboxId = mailboxIds[i % mailboxIds.length];
    const variant = variants[i % Math.max(1, variants.length)] ?? "A";
    const update: Record<string, unknown> = { mailbox_id: mailboxId, variant };

    if (usesAi) {
      update.state = "queued"; // research/draft pipeline picks it up
    } else {
      // human-like spacing per mailbox: cumulative jitter stagger
      perMailboxOffset[mailboxId] = (perMailboxOffset[mailboxId] ?? 0) + jitterSeconds();
      const tz =
        settings.timezone_mode === "lead"
          ? ((cl.leads as unknown as { timezone: string | null })?.timezone ?? settings.fixed_tz ?? "Europe/London")
          : (settings.fixed_tz ?? "Europe/London");
      update.state = "scheduled";
      update.next_send_at = computeNextSendAt({
        base: new Date(now.getTime() + perMailboxOffset[mailboxId] * 1000),
        delayDays: 0,
        window,
        timeZone: tz,
      }).toISOString();
    }
    await supabase.from("campaign_leads").update(update).eq("id", cl.id);
    i++;
  }

  await supabase.from("campaigns").update({ status: "running" }).eq("id", params.id);
  return NextResponse.json({ ok: true, scheduled: cls?.length ?? 0, uses_ai: usesAi });
}
