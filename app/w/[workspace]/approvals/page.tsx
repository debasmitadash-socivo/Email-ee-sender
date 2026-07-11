import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ApprovalQueue } from "./approval-queue";

export default async function ApprovalsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const { data: drafts } = await supabase
    .from("drafts")
    .select(
      "id, step_no, subject, body, qa, created_at, campaign_leads!inner(id, campaigns!inner(id, name, workspace_id, settings), leads!inner(email, first_name, last_name, company))"
    )
    .eq("status", "pending")
    .eq("campaign_leads.campaigns.workspace_id", workspace.id)
    .order("created_at")
    .limit(50);

  return (
    <div>
      <PageHeader
        title="Approval queue"
        description="AI-personalised drafts wait here for your yes before anything sends. Edit freely — what you approve is exactly what goes out."
      />
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ApprovalQueue drafts={(drafts ?? []) as any[]} />
    </div>
  );
}
