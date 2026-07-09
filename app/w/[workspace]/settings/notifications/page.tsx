import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { NotificationsForm } from "./notifications-form";

export default async function NotificationsSettingsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const [{ data: settings }, { data: mailboxes }] = await Promise.all([
    supabase.from("notification_settings").select("*").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("mailboxes").select("id, email").eq("workspace_id", workspace.id).eq("status", "active"),
  ]);

  return (
    <div>
      <PageHeader title="Notifications" />
      <NotificationsForm
        workspaceId={workspace.id}
        settings={settings}
        mailboxes={mailboxes ?? []}
      />
    </div>
  );
}
