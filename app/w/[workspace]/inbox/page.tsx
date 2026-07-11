import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { InboxClient } from "./inbox-client";
import { temperatureCategories } from "@/lib/temperature";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: { workspace: string };
  searchParams: { category?: string; temp?: string; lead?: string };
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
  else if (searchParams.temp && searchParams.temp in temperatureCategories) {
    const cats = temperatureCategories[searchParams.temp as keyof typeof temperatureCategories];
    if (cats.length) q = q.in("category", cats);
  }

  const [{ data: messages }, { data: positives }, { data: replyEvents }] = await Promise.all([
    q,
    supabase
      .from("campaign_leads")
      .select("id, state, stop_reason, campaigns!inner(name, workspace_id), leads!inner(email, first_name, last_name, company)")
      .eq("campaigns.workspace_id", workspace.id)
      .eq("state", "positive")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("events")
      .select("message_id, meta")
      .eq("workspace_id", workspace.id)
      .eq("type", "reply")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  // buying-signal scores keyed by message id (set by the reply classifier)
  const intent: Record<string, number> = {};
  for (const e of replyEvents ?? []) {
    const score = (e.meta as { buying_signal?: number })?.buying_signal;
    if (e.message_id && typeof score === "number") intent[e.message_id] = score;
  }

  return (
    <div>
      <PageHeader
        title="Master inbox"
        description="Replies to your outreach only, auto-categorised with a buying-signal score — newsletters and general mail never appear here. Reply inline; it threads from the original mailbox."
      />
      <InboxClient
        slug={workspace.slug}
        /* eslint-disable @typescript-eslint/no-explicit-any */
        messages={(messages ?? []) as any[]}
        positives={(positives ?? []) as any[]}
        /* eslint-enable @typescript-eslint/no-explicit-any */
        activeCategory={searchParams.category ?? null}
        activeTemp={searchParams.temp ?? null}
        intent={intent}
      />
    </div>
  );
}
