import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { CampaignBuilder } from "./builder";
import type { Campaign, SequenceStep } from "@/lib/types";

export default async function CampaignPage({
  params,
}: {
  params: { workspace: string; id: string };
}) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: campaign }, { data: steps }, { data: cms }, { data: mailboxes }, { data: lists }, { count: audience }, stateRows] =
    await Promise.all([
      supabase.from("campaigns").select("*").eq("id", params.id).maybeSingle(),
      supabase.from("sequence_steps").select("*").eq("campaign_id", params.id).order("step_no").order("variant"),
      supabase.from("campaign_mailboxes").select("mailbox_id").eq("campaign_id", params.id),
      supabase.from("mailboxes").select("id, email, provider, status").eq("workspace_id", workspace.id),
      supabase.from("lead_lists").select("id, name").eq("workspace_id", workspace.id),
      supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", params.id),
      supabase.from("campaign_leads").select("state").eq("campaign_id", params.id).limit(2000),
    ]);
  if (!campaign) notFound();

  const stateCounts: Record<string, number> = {};
  for (const r of stateRows.data ?? []) stateCounts[r.state] = (stateCounts[r.state] ?? 0) + 1;

  return (
    <CampaignBuilder
      campaign={campaign as Campaign}
      steps={(steps ?? []) as SequenceStep[]}
      attachedMailboxIds={(cms ?? []).map((r) => r.mailbox_id)}
      mailboxes={mailboxes ?? []}
      lists={lists ?? []}
      audienceCount={audience ?? 0}
      stateCounts={stateCounts}
      slug={workspace.slug}
    />
  );
}
