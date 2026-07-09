import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFromMailbox } from "@/lib/send";
import type { Mailbox } from "@/lib/types";

export const dynamic = "force-dynamic";

// Inline reply from the master inbox: threaded, from the originating mailbox.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { body } = await req.json();
  if (!body || typeof body !== "string") return NextResponse.json({ error: "body required" }, { status: 400 });

  // the inbound message being replied to (RLS-scoped)
  const { data: inbound } = await supabase.from("messages").select("*").eq("id", params.id).maybeSingle();
  if (!inbound || inbound.direction !== "inbound") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { data: mailbox } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("id", inbound.mailbox_id)
    .maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "originating mailbox not found" }, { status: 404 });

  const to = inbound.from_email;
  const subject = inbound.subject?.startsWith("Re:") ? inbound.subject : `Re: ${inbound.subject ?? ""}`;

  try {
    const admin = createAdminClient();
    const result = await sendFromMailbox(admin, mailbox as Mailbox, {
      to,
      subject,
      text: body,
      thread: {
        providerThreadId: inbound.provider_thread_id ?? undefined,
        providerMessageId: inbound.provider_message_id ?? undefined, // graph createReply target
        internetMessageId: inbound.internet_message_id ?? undefined,
      },
    });
    const { data: stored } = await admin
      .from("messages")
      .insert({
        workspace_id: inbound.workspace_id,
        mailbox_id: mailbox.id,
        campaign_lead_id: inbound.campaign_lead_id,
        direction: "outbound",
        provider_message_id: result.providerMessageId,
        provider_thread_id: result.providerThreadId ?? inbound.provider_thread_id,
        internet_message_id: result.internetMessageId,
        in_reply_to: inbound.internet_message_id,
        from_email: mailbox.email,
        to_email: to,
        subject,
        snippet: body.slice(0, 200),
        body,
        is_internal: true, // manual replies excluded from campaign analytics
      })
      .select()
      .single();
    return NextResponse.json({ ok: true, message: stored });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
