import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TeamClient } from "./team-client";

export default async function TeamPage({ params }: { params: { workspace: string } }) {
  const { workspace, role } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, users(name, email)")
      .eq("workspace_id", workspace.id),
    supabase
      .from("workspace_invites")
      .select("*")
      .eq("workspace_id", workspace.id)
      .is("accepted_at", null),
  ]);

  return (
    <div>
      <PageHeader title="Team" />
      <TeamClient
        workspaceId={workspace.id}
        isAdmin={role === "admin"}
        /* eslint-disable @typescript-eslint/no-explicit-any */
        members={(members ?? []) as any[]}
        invites={(invites ?? []) as any[]}
        /* eslint-enable @typescript-eslint/no-explicit-any */
      />
    </div>
  );
}
