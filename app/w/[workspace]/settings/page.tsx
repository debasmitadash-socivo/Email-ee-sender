import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { WorkspaceMembers, type MemberRow, type InviteRow } from "./workspace-members";
import { UsagePanel } from "./usage-panel";

export default async function SettingsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: members }, { data: invites }, { data: auth }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("workspace_id, user_id, role, users(email, name)")
      .eq("workspace_id", workspace.id),
    supabase
      .from("workspace_invites")
      .select("id, email, role, created_at")
      .eq("workspace_id", workspace.id)
      .is("accepted_at", null),
    supabase.auth.getUser(),
  ]);

  const currentUserId = auth.user?.id ?? "";
  const memberRows = (members ?? []) as unknown as MemberRow[];
  const currentRole = memberRows.find((m) => m.user_id === currentUserId)?.role ?? "l1_basic";

  return (
    <div className="space-y-10">
      <div>
        <PageHeader
          title="Workspace settings"
          description="Invite teammates into this workspace and control what each person can do."
        />
        <WorkspaceMembers
          workspaceId={workspace.id}
          members={memberRows}
          invites={(invites ?? []) as InviteRow[]}
          currentUserId={currentUserId}
          currentUserRole={currentRole}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Providers & quotas</h2>
        <p className="text-sm text-muted mb-6 max-w-2xl">
          Every external capability runs through an ordered provider chain with auto-failover. Add keys in
          Settings → API Keys (or environment variables); the chain skips missing keys automatically.
        </p>
        <UsagePanel workspaceId={workspace.id} />
      </div>
    </div>
  );
}
