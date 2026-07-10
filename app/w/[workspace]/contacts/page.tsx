import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ContactsClient } from "./contacts-client";

// CRM-style dashboard: one-at-a-time outreach on top of the same engine.
export default async function ContactsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();

  const [{ data: enrolments }, { data: templates }, { data: mailboxes }] = await Promise.all([
    // every campaign_lead in a contacts_key campaign, newest first
    supabase
      .from("campaign_leads")
      .select(
        "id, state, current_step, next_send_at, stop_reason, created_at, campaigns!inner(id, name, workspace_id, settings), leads!inner(id, email, first_name, last_name, company, title)"
      )
      .eq("campaigns.workspace_id", workspace.id)
      .not("campaigns.settings->>contacts_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("templates")
      .select("id, name, subject, body")
      .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
      .order("created_at", { ascending: false }),
    supabase
      .from("mailboxes")
      .select("id, email, status")
      .eq("workspace_id", workspace.id),
  ]);

  // last inbound reply category per enrolment (for temperature)
  const ids = (enrolments ?? []).map((e) => e.id);
  const lastCategory: Record<string, string> = {};
  if (ids.length) {
    const { data: inbound } = await supabase
      .from("messages")
      .select("campaign_lead_id, category, occurred_at")
      .in("campaign_lead_id", ids)
      .eq("direction", "inbound")
      .not("category", "is", null)
      .order("occurred_at", { ascending: true });
    for (const m of inbound ?? []) {
      if (m.campaign_lead_id && m.category) lastCategory[m.campaign_lead_id] = m.category;
    }
  }

  return (
    <div>
      <PageHeader title="Contacts" />
      <ContactsClient
        workspaceId={workspace.id}
        slug={workspace.slug}
        /* eslint-disable @typescript-eslint/no-explicit-any */
        enrolments={(enrolments ?? []) as any[]}
        templates={(templates ?? []) as any[]}
        mailboxes={(mailboxes ?? []) as any[]}
        /* eslint-enable @typescript-eslint/no-explicit-any */
        lastCategory={lastCategory}
      />
    </div>
  );
}
