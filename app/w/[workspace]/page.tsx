import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Chip, stateTone } from "@/components/ui";
import Link from "next/link";

export default async function DashboardPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ count: sent }, { count: replies }, { count: positives }, { count: bounces }, { data: campaigns }, { data: mailboxes }, { count: awaiting }] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("direction", "outbound")
        .eq("is_seed", false)
        .eq("is_internal", false)
        .gte("occurred_at", since30),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("type", "reply")
        .gte("created_at", since30),
      supabase
        .from("campaign_leads")
        .select("id, campaigns!inner(workspace_id)", { count: "exact", head: true })
        .eq("campaigns.workspace_id", workspace.id)
        .eq("state", "positive"),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("type", "bounce")
        .gte("created_at", since30),
      supabase
        .from("campaigns")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("mailboxes").select("*").eq("workspace_id", workspace.id),
      supabase
        .from("drafts")
        .select("id, campaign_leads!inner(campaigns!inner(workspace_id))", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("campaign_leads.campaigns.workspace_id", workspace.id),
    ]);

  const replyRate = sent ? (((replies ?? 0) / sent) * 100).toFixed(1) : "0.0";
  const bounceRate = sent ? (((bounces ?? 0) / sent) * 100).toFixed(1) : "0.0";

  const stats = [
    { label: "Sent (30d)", value: sent ?? 0 },
    { label: "Replies (30d)", value: replies ?? 0 },
    { label: "Reply rate", value: `${replyRate}%` },
    { label: "Positive", value: positives ?? 0 },
    { label: "Bounce rate", value: `${bounceRate}%` },
    { label: "Drafts awaiting approval", value: awaiting ?? 0 },
  ];

  return (
    <div>
      <PageHeader title={workspace.name} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-xs text-muted mt-1">{s.label}</div>
          </Card>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Recent campaigns</h2>
            <Link href={`/w/${workspace.slug}/campaigns`} className="text-sm text-secondary hover:underline">
              View all
            </Link>
          </div>
          {campaigns?.length ? (
            <ul className="divide-y divide-border">
              {campaigns.map((c) => (
                <li key={c.id} className="py-3 flex items-center justify-between">
                  <Link href={`/w/${workspace.slug}/campaigns/${c.id}`} className="text-sm hover:underline">
                    {c.name}
                  </Link>
                  <Chip tone={stateTone(c.status)}>{c.status}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No campaigns yet.</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Mailbox health</h2>
            <Link href={`/w/${workspace.slug}/mailboxes`} className="text-sm text-secondary hover:underline">
              Manage
            </Link>
          </div>
          {mailboxes?.length ? (
            <ul className="divide-y divide-border">
              {mailboxes.map((m) => (
                <li key={m.id} className="py-3 flex items-center justify-between text-sm">
                  <span>{m.email}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted tabular-nums">
                      {m.sent_today}/{m.daily_cap} today · health {m.health_score}
                    </span>
                    <Chip tone={stateTone(m.status)}>{m.status}</Chip>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No mailboxes connected.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
