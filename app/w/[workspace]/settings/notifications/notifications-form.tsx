"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Select } from "@/components/ui";

const EVENTS = [
  "positive_reply",
  "reply",
  "approval_queue_ready",
  "breaker_tripped",
  "mailbox_disconnected",
  "provider_quota_exhausted",
  "unsubscribe",
  "sequence_finished",
];

interface Settings {
  email_to: string | null;
  email_from_mailbox: string | null;
  telegram: boolean;
  n8n: boolean;
  instant_events: string[];
  digest_hour: number;
}

export function NotificationsForm({
  workspaceId,
  settings,
  mailboxes,
}: {
  workspaceId: string;
  settings: Settings | null;
  mailboxes: { id: string; email: string }[];
}) {
  const supabase = createClient();
  const [s, setS] = useState<Settings>(
    settings ?? {
      email_to: "",
      email_from_mailbox: null,
      telegram: false,
      n8n: false,
      instant_events: ["positive_reply", "reply", "breaker_tripped", "mailbox_disconnected", "provider_quota_exhausted"],
      digest_hour: 8,
    }
  );
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const { error } = await supabase
      .from("notification_settings")
      .upsert({ workspace_id: workspaceId, ...s, email_to: s.email_to || null });
    setMsg(error ? `Failed: ${error.message}` : "Saved.");
  }

  return (
    <Card className="max-w-lg">
      <div className="space-y-4">
        <div>
          <Label>Notification email (sent from one of your connected inboxes — £0)</Label>
          <Input
            type="email"
            value={s.email_to ?? ""}
            onChange={(e) => setS({ ...s, email_to: e.target.value })}
            placeholder="you@socivo.co.uk"
          />
          <div className="mt-2">
            <Label>Send from mailbox</Label>
            <Select
              value={s.email_from_mailbox ?? ""}
              onChange={(e) => setS({ ...s, email_from_mailbox: e.target.value || null })}
            >
              <option value="">— choose —</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.telegram}
            onChange={(e) => setS({ ...s, telegram: e.target.checked })}
            className="accent-[#B56FDC]"
          />
          Telegram (requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in env)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.n8n}
            onChange={(e) => setS({ ...s, n8n: e.target.checked })}
            className="accent-[#B56FDC]"
          />
          n8n webhook (requires N8N_WEBHOOK_URL in env)
        </label>
        <div>
          <Label>Instant events (everything else batches into the daily digest)</Label>
          <div className="space-y-1 mt-1">
            {EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.instant_events.includes(ev)}
                  onChange={(e) =>
                    setS({
                      ...s,
                      instant_events: e.target.checked
                        ? [...s.instant_events, ev]
                        : s.instant_events.filter((x) => x !== ev),
                    })
                  }
                  className="accent-[#B56FDC]"
                />
                {ev.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label>Daily digest hour (UTC)</Label>
          <Input
            type="number"
            min={0}
            max={23}
            className="w-20"
            value={s.digest_hour}
            onChange={(e) => setS({ ...s, digest_hour: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
