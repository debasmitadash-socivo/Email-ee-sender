import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { MailboxList } from "./mailbox-list";
import { WarmupToggle } from "./warmup-toggle";
import { PageHeader } from "@/components/ui";
import type { Mailbox } from "@/lib/types";

export default async function MailboxesPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const [{ data: mailboxes }, { data: knowledge }] = await Promise.all([
    supabase
      .from("mailboxes")
      .select("id, workspace_id, provider, email, display_name, status, daily_cap, ramp_started_at, sent_today, sent_date, health_score, consecutive_failures, signature_html, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    supabase.from("knowledge").select("profile").eq("workspace_id", workspace.id).maybeSingle(),
  ]);

  return (
    <div>
      <PageHeader
        title="Mailboxes"
        description="The inboxes you send from. Each has a warm-up ramp, daily cap, health score, DNS checker and its own email signature."
        action={
          <div className="flex gap-2">
            <a
              href={`/api/oauth/google/start?workspace=${workspace.id}&slug=${workspace.slug}`}
              className="inline-flex items-center rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Connect Gmail
            </a>
            <a
              href={`/api/oauth/microsoft/start?workspace=${workspace.id}&slug=${workspace.slug}`}
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:border-muted"
            >
              Connect Outlook
            </a>
          </div>
        }
      />
      <MailboxList mailboxes={(mailboxes ?? []) as unknown as Mailbox[]} />
      <WarmupToggle
        workspaceId={workspace.id}
        enabled={!!(knowledge?.profile as { warmup_enabled?: boolean } | null)?.warmup_enabled}
        mailboxCount={(mailboxes ?? []).filter((m) => m.status === "active").length}
      />
    </div>
  );
}
