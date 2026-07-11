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
  searchParams: { list?: string; tag?: string };
}) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: lists }, leadsRes, { data: tagRows }] = await Promise.all([
    supabase.from("lead_lists").select("*").eq("workspace_id", workspace.id).order("created_at"),
    (() => {
      let q = supabase
        .from("leads")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (searchParams.list) q = q.eq("list_id", searchParams.list);
      if (searchParams.tag) q = q.contains("tags", [searchParams.tag]);
      return q;
    })(),
    // distinct tags across the workspace for the filter row
    supabase.from("leads").select("tags").eq("workspace_id", workspace.id).limit(2000),
  ]);

  const allTags = Array.from(
    new Set((tagRows ?? []).flatMap((r) => (r.tags as string[] | null) ?? []))
  ).sort();

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Your raw prospect database. Import CSVs (Apollo, Sales Navigator, any format), verify emails, then organise people into lists and tag them into buckets — Campaigns pull their audience from here."
      />
      <LeadsClient
        workspaceId={workspace.id}
        slug={workspace.slug}
        lists={lists ?? []}
        leads={(leadsRes.data ?? []) as Lead[]}
        activeList={searchParams.list ?? null}
        activeTag={searchParams.tag ?? null}
        allTags={allTags}
      />
    </div>
  );
}
