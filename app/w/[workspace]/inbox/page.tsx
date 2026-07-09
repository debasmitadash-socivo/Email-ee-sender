import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { InboxClient } from "./inbox-client";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: { workspace: string };
  searchParams: { category?: string; lead?: string };
}) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  let q = supabase
    .from("messages")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("direction", "inbound")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (searchParams.category) q = q.eq("category", searchParams.category);

  const [{ data: messages }, { data: positives }] = await Promise.all([
    q,
    supabase
      .from("campaign_leads")
      .select("id, state, stop_reason, campaigns!inner(name, workspace_id), leads!inner(email, first_name, last_name, company)")
      .eq("campaigns.workspace_id", workspace.id)
      .eq("state", "positive")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div>
      <PageHeader title="Master inbox" />
      <InboxClient
        slug={workspace.slug}
        /* eslint-disable @typescript-eslint/no-explicit-any */
        messages={(messages ?? []) as any[]}
        positives={(positives ?? []) as any[]}
        /* eslint-enable @typescript-eslint/no-explicit-any */
        activeCategory={searchParams.category ?? null}
      />
    </div>
  );
}
