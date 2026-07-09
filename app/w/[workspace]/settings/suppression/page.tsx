import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { SuppressionClient } from "./suppression-client";

export default async function SuppressionPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  // RLS shows workspace rows + global (null workspace) rows
  const { data: entries } = await supabase
    .from("suppression")
    .select("*")
    .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div>
      <PageHeader title="Suppression list" />
      <SuppressionClient workspaceId={workspace.id} entries={entries ?? []} />
    </div>
  );
}
