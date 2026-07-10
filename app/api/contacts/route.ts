import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/api-guard";
import { computeNextSendAt, DEFAULT_WINDOW } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// CRM-style single-contact flow: add one person + a template + a cadence
// ("every N days, up to M times"). Behind the scenes this creates/reuses a
// campaign keyed by (template, cadence) so the existing tick engine handles
// sending, threading, guards, stop-on-reply and notifications untouched.

const FOLLOW_UP_BODIES = [
  "Hi {{first_name}},\n\nI wanted to bring this back to the top of your inbox in case it got buried. Worth a quick look?",
  "Hi {{first_name}},\n\nAny thoughts on the below? Happy to answer questions — or close the loop if it's not relevant.",
  "Hi {{first_name}},\n\nI'll leave this here — if the timing's off, no problem at all. The note below explains what I had in mind.",
];

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    workspace_id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    title?: string;
    template_id: string;
    mailbox_id: string;
    every_days?: number;
    times?: number;
  };
  const { workspace_id, email, template_id, mailbox_id } = body;
  if (!workspace_id || !email?.includes("@") || !template_id || !mailbox_id) {
    return NextResponse.json(
      { error: "workspace_id, email, template_id and mailbox_id are required" },
      { status: 400 }
    );
  }
  if (!(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const everyDays = Math.max(1, Math.min(30, Math.round(body.every_days ?? 3)));
  const times = Math.max(1, Math.min(6, Math.round(body.times ?? 3)));

  const supabase = createClient();

  // template (workspace or global library — RLS allows both)
  const { data: template } = await supabase.from("templates").select("*").eq("id", template_id).maybeSingle();
  if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });

  // mailbox must belong to this workspace and be usable
  const { data: mailbox } = await supabase
    .from("mailboxes")
    .select("id, status, workspace_id")
    .eq("id", mailbox_id)
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "mailbox not found" }, { status: 404 });
  if (mailbox.status !== "active") {
    return NextResponse.json({ error: `mailbox is ${mailbox.status}` }, { status: 422 });
  }

  // upsert the lead
  const cleanEmail = email.trim().toLowerCase();
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .upsert(
      {
        workspace_id,
        email: cleanEmail,
        first_name: body.first_name || null,
        last_name: body.last_name || null,
        company: body.company || null,
        title: body.title || null,
        domain: cleanEmail.split("@")[1],
      },
      { onConflict: "workspace_id,email" }
    )
    .select()
    .single();
  if (leadErr || !lead) return NextResponse.json({ error: leadErr?.message ?? "lead upsert failed" }, { status: 500 });

  // find-or-create the always-on campaign for this (template, cadence) combo
  const contactsKey = `${template_id}:${everyDays}:${times}`;
  const { data: existing } = await supabase
    .from("campaigns")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("settings->>contacts_key", contactsKey)
    .maybeSingle();

  let campaign = existing;
  if (!campaign) {
    const { data: created, error: cErr } = await supabase
      .from("campaigns")
      .insert({
        workspace_id,
        name: `Contacts · ${template.name} · every ${everyDays}d ×${times}`,
        status: "running",
        settings: {
          contacts_key: contactsKey,
          plain_text: true,
          track_opens: false,
          track_clicks: false,
          // CRM flow: every AI draft gets a human yes before sending
          approve_first_n: 1_000_000,
          send_window: DEFAULT_WINDOW,
          timezone_mode: "fixed",
          fixed_tz: "Europe/London",
          linkedin_enrichment: false,
          daily_domain_cap: 5,
          allow_free_domains: true, // 1:1 adds are deliberate — don't block personal addresses
          us_targeting: false,
        },
      })
      .select()
      .single();
    if (cErr || !created) return NextResponse.json({ error: cErr?.message ?? "campaign create failed" }, { status: 500 });
    campaign = created;

    // sequence: step 1 = the template; follow-ups = gentle bumps in the same thread
    const steps = [
      { campaign_id: campaign.id, step_no: 1, variant: "A", delay_days: 0, subject: template.subject, body: template.body },
      ...Array.from({ length: times - 1 }, (_, i) => ({
        campaign_id: campaign.id,
        step_no: i + 2,
        variant: "A",
        delay_days: everyDays,
        subject: null as string | null, // blank = same thread, Re:
        body: FOLLOW_UP_BODIES[i % FOLLOW_UP_BODIES.length],
      })),
    ];
    const { error: sErr } = await supabase.from("sequence_steps").insert(steps);
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  // attach the mailbox (idempotent)
  await supabase
    .from("campaign_mailboxes")
    .upsert({ campaign_id: campaign.id, mailbox_id }, { onConflict: "campaign_id,mailbox_id", ignoreDuplicates: true });

  // notifications: this flow notifies on ANY reply, not just positive ones
  const { data: notif } = await supabase
    .from("notification_settings")
    .select("workspace_id, instant_events")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (!notif) {
    await supabase.from("notification_settings").insert({
      workspace_id,
      instant_events: ["positive_reply", "reply", "breaker_tripped", "mailbox_disconnected"],
    });
  } else if (!notif.instant_events.includes("reply")) {
    await supabase
      .from("notification_settings")
      .update({ instant_events: [...notif.instant_events, "reply"] })
      .eq("workspace_id", workspace_id);
  }

  // enrol the contact
  const usesAi = /\{\{\s*ai_[a-zA-Z0-9_]+\s*\}\}/.test(`${template.subject} ${template.body}`);
  const enrolment = usesAi
    ? { state: "queued" as const, next_send_at: null } // research → draft → your approval → send
    : {
        state: "scheduled" as const,
        next_send_at: computeNextSendAt({
          base: new Date(),
          delayDays: 0,
          window: DEFAULT_WINDOW,
          timeZone: "Europe/London",
        }).toISOString(),
      };

  const { data: cl, error: clErr } = await supabase
    .from("campaign_leads")
    .insert({ campaign_id: campaign.id, lead_id: lead.id, mailbox_id, ...enrolment })
    .select()
    .single();
  if (clErr) {
    if (clErr.code === "23505") {
      return NextResponse.json({ error: "This contact is already enrolled with this template + cadence." }, { status: 409 });
    }
    return NextResponse.json({ error: clErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    contact: cl,
    campaign_id: campaign.id,
    flow: usesAi ? "awaiting_research_then_approval" : "scheduled",
  });
}
