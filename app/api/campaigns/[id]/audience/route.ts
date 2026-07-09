import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Set campaign audience (from a list or explicit lead ids) and mailboxes.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const body = (await req.json()) as {
    list_id?: string;
    lead_ids?: string[];
    mailbox_ids?: string[];
    exclude_invalid?: boolean;
  };

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, workspace_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  // mailboxes
  if (Array.isArray(body.mailbox_ids)) {
    await supabase.from("campaign_mailboxes").delete().eq("campaign_id", params.id);
    if (body.mailbox_ids.length) {
      const { error } = await supabase
        .from("campaign_mailboxes")
        .insert(body.mailbox_ids.map((m) => ({ campaign_id: params.id, mailbox_id: m })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // leads
  let leadIds = body.lead_ids ?? [];
  if (body.list_id) {
    let q = supabase
      .from("leads")
      .select("id, verify_status")
      .eq("workspace_id", campaign.workspace_id)
      .eq("list_id", body.list_id);
    const { data: listLeads, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    leadIds = (listLeads ?? [])
      .filter((l) => (body.exclude_invalid !== false ? l.verify_status !== "invalid" : true))
      .map((l) => l.id);
  }

  let added = 0;
  if (leadIds.length) {
    const { data, error } = await supabase
      .from("campaign_leads")
      .upsert(
        leadIds.map((lead_id) => ({ campaign_id: params.id, lead_id, state: "queued" as const })),
        { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
      )
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    added = data?.length ?? 0;
  }

  return NextResponse.json({ added });
}
