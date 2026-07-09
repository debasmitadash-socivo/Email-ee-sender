import { requireWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/ui";
import { UsagePanel } from "./usage-panel";

export default async function SettingsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  return (
    <div>
      <PageHeader title="Providers & quotas" />
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Every external capability runs through an ordered provider chain with auto-failover. Keys live in the
        deployment's environment variables (<code>.env</code>) — add or remove keys there and redeploy; the
        chain skips missing keys automatically. Quota ceilings are set in <code>config/providers.ts</code>.
      </p>
      <UsagePanel workspaceId={workspace.id} />
    </div>
  );
}
