import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { WebhooksClient } from "./webhooks-client";
import { signToken } from "@/lib/crypto";

export default async function WebhooksPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const { data: hooks } = await supabase
    .from("webhooks")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at");

  // workspace REST API token (HMAC-derived; no schema needed)
  const apiToken = await signToken({ ws: workspace.id, kind: "api" });

  return (
    <div>
      <PageHeader title="Webhooks & API" />
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <WebhooksClient workspaceId={workspace.id} hooks={(hooks ?? []) as any[]} apiToken={apiToken} />
    </div>
  );
}
