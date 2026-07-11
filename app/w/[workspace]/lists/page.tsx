import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ListsManager } from "./lists-manager";

export default async function ListsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: lists }, { data: tags }, { count: leadCount }] = await Promise.all([
    supabase
      .from("lead_lists")
      .select("id, name, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("lead_tags")
      .select("tag")
      .eq("workspace_id", workspace.id)
      .distinct()
      .order("tag"),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
  ]);

  return (
    <div>
      <PageHeader
        title="Lists & tags"
        description="Organize leads into lists (for sequential campaigns) or tags (for flexible grouping). Use these to build campaign audiences."
      />
      <ListsManager
        workspaceId={workspace.id}
        lists={lists ?? []}
        allTags={[...new Set(tags?.map((t: any) => t.tag) ?? [])].sort()}
        totalLeads={leadCount ?? 0}
      />
    </div>
  );
}
