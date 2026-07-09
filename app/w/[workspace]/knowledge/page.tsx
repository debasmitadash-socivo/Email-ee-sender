import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { KnowledgeForm } from "./knowledge-form";
import type { KnowledgeProfile } from "@/lib/types";

export default async function KnowledgePage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const { data } = await supabase
    .from("knowledge")
    .select("profile")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  return (
    <div>
      <PageHeader title="Knowledge base" />
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Everything the AI needs to write like you: offer, ICP, proof points, tone. The brief builder and
        writer read this profile on every draft. The footer identity appears in every outbound email
        (compliance requirement).
      </p>
      <KnowledgeForm workspaceId={workspace.id} profile={(data?.profile ?? {}) as KnowledgeProfile} />
    </div>
  );
}
