import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ListsManager } from "./lists-manager";

export default async function ListsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: lists }, { data: leadRows }, { count: leadCount }] = await Promise.all([
    supabase
      .from("lead_lists")
      .select("id, name, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("list_id, tags").eq("workspace_id", workspace.id).limit(5000),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id),
  ]);

  // per-list lead counts + tag usage counts, computed from one cheap scan
  const listCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  for (const r of leadRows ?? []) {
    if (r.list_id) listCounts[r.list_id] = (listCounts[r.list_id] ?? 0) + 1;
    for (const t of (r.tags as string[] | null) ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }

  return (
    <div>
      <PageHeader
        title="Lists & tags"
        description="Organise leads into lists (fixed groups, one per campaign or cohort) or tags (flexible labels). Campaigns pull their audience from either."
      />
      <ListsManager
        workspaceId={workspace.id}
        slug={workspace.slug}
        lists={(lists ?? []).map((l) => ({ ...l, count: listCounts[l.id] ?? 0 }))}
        tagCounts={tagCounts}
        totalLeads={leadCount ?? 0}
      />
    </div>
  );
}
