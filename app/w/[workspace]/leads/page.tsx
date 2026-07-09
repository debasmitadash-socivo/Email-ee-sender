import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { LeadsClient } from "./leads-client";
import type { Lead } from "@/lib/types";

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: { workspace: string };
  searchParams: { list?: string };
}) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: lists }, leadsRes] = await Promise.all([
    supabase.from("lead_lists").select("*").eq("workspace_id", workspace.id).order("created_at"),
    (() => {
      let q = supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (searchParams.list) q = q.eq("list_id", searchParams.list);
      return q;
    })(),
  ]);

  return (
    <div>
      <PageHeader title="Leads" />
      <LeadsClient
        workspaceId={workspace.id}
        slug={workspace.slug}
        lists={lists ?? []}
        leads={(leadsRes.data ?? []) as Lead[]}
        activeList={searchParams.list ?? null}
      />
    </div>
  );
}
