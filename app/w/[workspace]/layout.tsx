import { Topbar } from "@/components/topbar";
import { requireWorkspace } from "@/lib/workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { workspace: string };
}) {
  const { workspace, allWorkspaces } = await requireWorkspace(params.workspace);
  return (
    <div className="min-h-screen">
      <Topbar workspace={workspace} allWorkspaces={allWorkspaces} />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
