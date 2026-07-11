import { requireWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/ui";
import { KeysClient } from "./keys-client";
import { addableProviders } from "@/config/providers";

export default async function KeysPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  return (
    <div>
      <PageHeader title="API keys" />
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Add your free API keys here — no editing config files. You can add{" "}
        <strong>more than one key per provider</strong> to stack free tiers: when one hits its daily limit,
        the engine automatically rotates to the next, and you get notified. Keys are encrypted at rest and
        never shown again after saving.
      </p>
      <KeysClient workspaceId={workspace.id} providers={addableProviders} />
    </div>
  );
}
