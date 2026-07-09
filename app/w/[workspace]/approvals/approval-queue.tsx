"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Empty, Input, Textarea } from "@/components/ui";

interface DraftRow {
  id: string;
  step_no: number;
  subject: string | null;
  body: string;
  qa: { flagged?: boolean; used_fact_source?: string; attempts?: { issues: string[] }[] } | null;
  campaign_leads: {
    campaigns: { name: string };
    leads: { email: string; first_name: string | null; last_name: string | null; company: string | null };
  };
}

export function ApprovalQueue({ drafts }: { drafts: DraftRow[] }) {
  const router = useRouter();
  if (!drafts.length) return <Empty>Nothing awaiting approval. Drafts appear here as research completes.</Empty>;
  return (
    <div className="space-y-4">
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} onDone={() => router.refresh()} />
      ))}
    </div>
  );
}

function DraftCard({ draft, onDone }: { draft: DraftRow; onDone: () => void }) {
  const lead = draft.campaign_leads.leads;
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const edited = subject !== (draft.subject ?? "") || body !== draft.body;
  const lastIssues = draft.qa?.attempts?.at(-1)?.issues ?? [];

  async function act(action: "approve" | "reject") {
    setBusy(true);
    await fetch(`/api/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "approve" && edited
          ? { action, edited_subject: subject, edited_body: body }
          : { action }
      ),
    });
    setBusy(false);
    onDone();
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm">
          <span className="font-medium">
            {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email}
          </span>{" "}
          <span className="text-muted">
            {lead.company ? `· ${lead.company} ` : ""}· {draft.campaign_leads.campaigns.name} · step {draft.step_no}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {draft.qa?.flagged && <Chip tone="warn">QA flagged</Chip>}
          {draft.qa?.used_fact_source && (
            <a
              href={draft.qa.used_fact_source}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-secondary hover:underline"
            >
              fact source ↗
            </a>
          )}
        </div>
      </div>
      {draft.qa?.flagged && lastIssues.length > 0 && (
        <p className="text-xs text-warn mb-2">QA issues: {lastIssues.join("; ")}</p>
      )}
      <div className="space-y-2">
        {draft.subject !== null && (
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        )}
        <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="flex gap-2 mt-3">
        <Button onClick={() => act("approve")} disabled={busy}>
          {edited ? "Approve with edits" : "Approve"}
        </Button>
        <Button variant="danger" onClick={() => act("reject")} disabled={busy}>
          Reject & regenerate
        </Button>
      </div>
    </Card>
  );
}
