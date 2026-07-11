import { verifyToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// White-label client report (Phase 7): a read-only, no-login performance page
// behind an HMAC-signed link. Share it with a client; they see their numbers
// and nothing else — no app chrome, no other workspaces, no Socivo branding.
export default async function PortalPage({ params }: { params: { token: string } }) {
  const payload = await verifyToken(params.token);
  if (!payload || payload.kind !== "portal" || !payload.ws) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted">This report link is invalid or has expired.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: workspace }, { data: campaigns }, { data: outbound }, { data: events }, { data: positives }] =
    await Promise.all([
      admin.from("workspaces").select("name").eq("id", payload.ws).single(),
      admin.from("campaigns").select("id, name, status").eq("workspace_id", payload.ws).order("created_at", { ascending: false }),
      admin
        .from("messages")
        .select("campaign_lead_id, campaign_leads(campaign_id)")
        .eq("workspace_id", payload.ws)
        .eq("direction", "outbound")
        .eq("is_seed", false)
        .eq("is_internal", false)
        .gte("occurred_at", since),
      admin
        .from("events")
        .select("type, campaign_lead_id, campaign_leads(campaign_id)")
        .eq("workspace_id", payload.ws)
        .in("type", ["reply", "bounce"])
        .gte("created_at", since),
      admin
        .from("campaign_leads")
        .select("campaign_id, campaigns!inner(workspace_id)")
        .eq("campaigns.workspace_id", payload.ws)
        .eq("state", "positive"),
    ]);

  const perCampaign: Record<string, { sent: number; replies: number; bounces: number; positive: number }> = {};
  const bump = (cid: string | null | undefined, key: "sent" | "replies" | "bounces" | "positive") => {
    if (!cid) return;
    perCampaign[cid] ??= { sent: 0, replies: 0, bounces: 0, positive: 0 };
    perCampaign[cid][key]++;
  };
  for (const m of outbound ?? []) bump((m.campaign_leads as unknown as { campaign_id: string })?.campaign_id, "sent");
  for (const e of events ?? []) {
    const cid = (e.campaign_leads as unknown as { campaign_id: string })?.campaign_id;
    bump(cid, e.type === "reply" ? "replies" : "bounces");
  }
  for (const p of positives ?? []) bump(p.campaign_id, "positive");

  const totals = Object.values(perCampaign).reduce(
    (a, c) => ({ sent: a.sent + c.sent, replies: a.replies + c.replies, bounces: a.bounces + c.bounces, positive: a.positive + c.positive }),
    { sent: 0, replies: 0, bounces: 0, positive: 0 }
  );
  const replyRate = totals.sent ? ((totals.replies / totals.sent) * 100).toFixed(1) : "0.0";

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-sm">{workspace?.name ?? "Report"}</span>
          <span className="text-xs text-muted">Outreach performance · last 30 days</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Emails sent", value: totals.sent },
            { label: "Replies", value: totals.replies },
            { label: "Reply rate", value: `${replyRate}%` },
            { label: "Positive conversations", value: totals.positive },
          ].map((s) => (
            <div key={s.label} className="card p-5">
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["Campaign", "Status", "Sent", "Replies", "Positive", "Bounces"].map((h) => (
                  <th key={h} className="text-left font-medium text-muted px-4 py-3 border-b border-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(campaigns ?? []).map((c) => {
                const s = perCampaign[c.id] ?? { sent: 0, replies: 0, bounces: 0, positive: 0 };
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 border-b border-border">{c.name}</td>
                    <td className="px-4 py-3 border-b border-border text-muted">{c.status}</td>
                    <td className="px-4 py-3 border-b border-border tabular-nums">{s.sent}</td>
                    <td className="px-4 py-3 border-b border-border tabular-nums">{s.replies}</td>
                    <td className="px-4 py-3 border-b border-border tabular-nums">{s.positive}</td>
                    <td className="px-4 py-3 border-b border-border tabular-nums">{s.bounces}</td>
                  </tr>
                );
              })}
              {!campaigns?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-muted text-center">
                    No campaigns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-6">
          Figures computed live from the sending records. Positive = replies expressing interest or
          requesting information.
        </p>
      </main>
    </div>
  );
}
