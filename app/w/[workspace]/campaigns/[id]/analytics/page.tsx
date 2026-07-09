import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ExportCsvButton } from "./export-csv";
import Link from "next/link";

// Analytics computed straight from messages/events — no materialised views,
// numbers reconcile against raw tables (§13).
export default async function CampaignAnalyticsPage({
  params,
}: {
  params: { workspace: string; id: string };
}) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", params.id).maybeSingle();
  if (!campaign) notFound();
  const settings = campaign.settings ?? {};

  const [{ data: outbound }, { data: clStates }, { data: events }] = await Promise.all([
    supabase
      .from("messages")
      .select("step_no, campaign_lead_id, campaign_leads!inner(campaign_id, variant)")
      .eq("direction", "outbound")
      .eq("is_seed", false)
      .eq("is_internal", false)
      .eq("campaign_leads.campaign_id", params.id),
    supabase.from("campaign_leads").select("id, state, variant").eq("campaign_id", params.id),
    supabase
      .from("events")
      .select("type, campaign_lead_id, campaign_leads!inner(campaign_id)")
      .eq("campaign_leads.campaign_id", params.id),
  ]);

  const sent = outbound?.length ?? 0;
  const bounces = events?.filter((e) => e.type === "bounce").length ?? 0;
  const replies = events?.filter((e) => e.type === "reply").length ?? 0;
  const unsubs = events?.filter((e) => e.type === "unsubscribe").length ?? 0;
  const opens = events?.filter((e) => e.type === "open").length ?? 0;
  const clicks = events?.filter((e) => e.type === "click").length ?? 0;
  const positive = clStates?.filter((c) => c.state === "positive").length ?? 0;
  const delivered = sent - bounces;

  // per-step, per-variant table
  const byStepVariant: Record<string, { sent: number; replied: Set<string> }> = {};
  for (const m of outbound ?? []) {
    const variant = (m.campaign_leads as unknown as { variant: string })?.variant ?? "A";
    const key = `${m.step_no ?? 1}|${variant}`;
    byStepVariant[key] ??= { sent: 0, replied: new Set() };
    byStepVariant[key].sent++;
  }
  const repliedCls = new Set(
    (events ?? []).filter((e) => e.type === "reply").map((e) => e.campaign_lead_id).filter(Boolean)
  );
  // attribute a reply to the last step sent to that lead
  const lastStepByCl: Record<string, { step: number; variant: string }> = {};
  for (const m of outbound ?? []) {
    const clId = m.campaign_lead_id as string;
    const variant = (m.campaign_leads as unknown as { variant: string })?.variant ?? "A";
    if (!lastStepByCl[clId] || (m.step_no ?? 1) > lastStepByCl[clId].step) {
      lastStepByCl[clId] = { step: m.step_no ?? 1, variant };
    }
  }
  for (const clId of repliedCls) {
    const last = lastStepByCl[clId as string];
    if (last) byStepVariant[`${last.step}|${last.variant}`]?.replied.add(clId as string);
  }

  const funnel = [
    { label: "Sent", value: sent },
    { label: "Delivered", value: delivered },
    { label: "Replied", value: replies },
    { label: "Positive", value: positive },
  ];
  const max = Math.max(1, sent);

  const tableRows = Object.entries(byStepVariant)
    .map(([key, v]) => {
      const [step, variant] = key.split("|");
      return { step: Number(step), variant, sent: v.sent, replies: v.replied.size };
    })
    .sort((a, b) => a.step - b.step || a.variant.localeCompare(b.variant));

  const csvRows: (string | number)[][] = [
    ["step", "variant", "sent", "replies", "reply_rate"],
    ...tableRows.map((r) => [r.step, r.variant, r.sent, r.replies, r.sent ? (r.replies / r.sent).toFixed(3) : "0"]),
  ];

  return (
    <div>
      <PageHeader
        title={`${campaign.name} — analytics`}
        action={
          <div className="flex gap-2 items-center">
            <ExportCsvButton rows={csvRows} filename={`${campaign.name}-analytics.csv`} />
            <Link href={`/w/${workspace.slug}/campaigns/${campaign.id}`} className="text-sm text-secondary hover:underline">
              ← builder
            </Link>
          </div>
        }
      />

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-base font-semibold mb-4">Funnel</h2>
          <div className="space-y-3">
            {funnel.map((f) => (
              <div key={f.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{f.label}</span>
                  <span className="tabular-nums">
                    {f.value}
                    {sent > 0 && f.label !== "Sent" && (
                      <span className="text-muted"> ({((f.value / sent) * 100).toFixed(1)}%)</span>
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full border border-border overflow-hidden">
                  <div className="h-full bg-secondary/60" style={{ width: `${(f.value / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-sm text-muted space-y-1">
            <div>Bounces: {bounces} ({sent ? ((bounces / sent) * 100).toFixed(1) : 0}%)</div>
            <div>Unsubscribes: {unsubs}</div>
            {(settings.track_opens || settings.track_clicks) && (
              <div>
                Opens: {opens} · Clicks: {clicks}{" "}
                <span className="text-warn">(unreliable by nature)</span>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-semibold mb-4">Per step / variant</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-2 font-medium">Step</th>
                <th className="pb-2 font-medium">Variant</th>
                <th className="pb-2 font-medium">Sent</th>
                <th className="pb-2 font-medium">Replies</th>
                <th className="pb-2 font-medium">Reply rate</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2">{r.step}</td>
                  <td className="py-2">{r.variant}</td>
                  <td className="py-2 tabular-nums">{r.sent}</td>
                  <td className="py-2 tabular-nums">{r.replies}</td>
                  <td className="py-2 tabular-nums">{r.sent ? ((r.replies / r.sent) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
              {!tableRows.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted">
                    Nothing sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
