import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TemplatesClient } from "./templates-client";

export default async function TemplatesPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  // workspace templates + global library (workspace_id null)
  const { data: templates } = await supabase
    .from("templates")
    .select("*")
    .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="Templates" />
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <TemplatesClient workspaceId={workspace.id} templates={(templates ?? []) as any[]} />
    </div>
  );
}
