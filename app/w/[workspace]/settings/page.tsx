import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { WorkspaceMembers } from "./workspace-members";
import { UsagePanel } from "./usage-panel";

export default async function SettingsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: members }, { data: user }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("id, user_id, role, invited_at, accepted_at, users!inner(email)")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    supabase.auth.getUser(),
  ]);

  const currentMemberRole = members?.find((m: any) => m.user_id === user.user?.id)?.role;

  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="Workspace settings" description="Manage members and access." />
        <WorkspaceMembers
          workspaceId={workspace.id}
          members={(members ?? []) as unknown as any[]}
          currentUserRole={currentMemberRole as string}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Providers & quotas</h2>
        <p className="text-sm text-muted mb-6 max-w-2xl">
          Every external capability runs through an ordered provider chain with auto-failover. Keys live in the
          deployment's environment variables (<code>.env</code>) — add or remove keys there and redeploy; the
          chain skips missing keys automatically. Quota ceilings are set in <code>config/providers.ts</code>.
        </p>
        <UsagePanel workspaceId={workspace.id} />
      </div>
    </div>
  );
}
