"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";

// Peer warmup toggle (Phase 7). Stored in knowledge.profile.warmup_enabled;
// the tick engine sends 2 short notes/day between your own active mailboxes.
export function WarmupToggle({
  workspaceId,
  enabled: initial,
  mailboxCount,
}: {
  workspaceId: string;
  enabled: boolean;
  mailboxCount: number;
}) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !enabled;
    // merge into the existing profile rather than overwriting it
    const { data } = await supabase.from("knowledge").select("profile").eq("workspace_id", workspaceId).maybeSingle();
    await supabase.from("knowledge").upsert({
      workspace_id: workspaceId,
      profile: { ...(data?.profile ?? {}), warmup_enabled: next },
      updated_at: new Date().toISOString(),
    });
    setEnabled(next);
    setBusy(false);
  }

  return (
    <Card className="mt-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold mb-1">Peer warmup {enabled && <span className="text-success">· on</span>}</h2>
          <p className="text-xs text-muted">
            Your own connected inboxes send each other 2 short, human-looking notes a day, building sending
            history for new mailboxes. Needs 2+ active mailboxes (you have {mailboxCount}). Warmup mail never
            appears in your inbox or analytics, and counts against each mailbox's daily ramp budget. Honest
            note: this is a light version of paid warmup pools — helpful for new inboxes, not a magic
            reputation fix.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={enabled}
            onChange={toggle}
            disabled={busy || (mailboxCount < 2 && !enabled)}
            className="accent-[#B56FDC] h-4 w-4"
          />
          {enabled ? "Enabled" : mailboxCount < 2 ? "Connect a 2nd mailbox first" : "Enable warmup"}
        </label>
      </div>
    </Card>
  );
}
