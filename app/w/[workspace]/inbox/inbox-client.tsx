"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Empty, Textarea, stateTone } from "@/components/ui";
import type { Message } from "@/lib/types";

const CATEGORIES = [
  "interested",
  "info_request",
  "not_now",
  "not_interested",
  "ooo",
  "wrong_person",
  "bounce",
  "unsubscribe",
  "other",
] as const;

interface PositiveRow {
  id: string;
  campaigns: { name: string };
  leads: { email: string; first_name: string | null; last_name: string | null; company: string | null };
}

const TEMPS = [
  { key: "warm", label: "🟢 Warm" },
  { key: "neutral", label: "🟡 Neutral" },
  { key: "rejected", label: "🔴 Rejected" },
] as const;

export function InboxClient({
  slug,
  messages,
  positives,
  activeCategory,
  activeTemp,
  intent = {},
}: {
  slug: string;
  messages: Message[];
  positives: PositiveRow[];
  activeCategory: string | null;
  activeTemp: string | null;
  intent?: Record<string, number>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Message | null>(null);

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <FilterChip
            label="All"
            active={!activeCategory && !activeTemp}
            onClick={() => router.push(`/w/${slug}/inbox`)}
          />
          {TEMPS.map((t) => (
            <FilterChip
              key={t.key}
              label={t.label}
              active={activeTemp === t.key}
              onClick={() => router.push(`/w/${slug}/inbox?temp=${t.key}`)}
            />
          ))}
        </div>
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              label={c.replace("_", " ")}
              active={activeCategory === c}
              onClick={() => router.push(`/w/${slug}/inbox?category=${c}`)}
            />
          ))}
        </div>
        {messages.length ? (
          <div className="card divide-y divide-border">
            {messages.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="w-full text-left px-4 py-3 hover:bg-border/20 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{m.from_email}</span>
                    {m.category && <Chip tone={stateTone(m.category)}>{m.category.replace("_", " ")}</Chip>}
                    {intent[m.id] !== undefined && intent[m.id] > 0 && (
                      <Chip tone={intent[m.id] >= 7 ? "danger" : "warn"}>🔥 {intent[m.id]}/10</Chip>
                    )}
                  </div>
                  <div className="text-sm truncate">{m.subject}</div>
                  <div className="text-xs text-muted truncate">{m.snippet}</div>
                </div>
                <span className="text-xs text-muted whitespace-nowrap">
                  {new Date(m.occurred_at).toLocaleDateString("en-GB")}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty>No replies yet. Inbound mail lands here as the tick polls your mailboxes.</Empty>
        )}
      </div>

      <div>
        <Card>
          <h2 className="text-sm font-semibold mb-3">Positive pipeline</h2>
          {positives.length ? (
            <ul className="space-y-2">
              {positives.map((p) => (
                <li key={p.id} className="text-sm border border-border rounded-md px-3 py-2">
                  <div className="font-medium">
                    {[p.leads.first_name, p.leads.last_name].filter(Boolean).join(" ") || p.leads.email}
                  </div>
                  <div className="text-xs text-muted">
                    {p.leads.company ? `${p.leads.company} · ` : ""}
                    {p.campaigns.name}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Interested and info-request replies pile up here.</p>
          )}
        </Card>
      </div>

      {selected && <ThreadDrawer message={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border ${
        active ? "border-primary text-primary font-medium" : "border-border text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function ThreadDrawer({ message, onClose }: { message: Message; onClose: () => void }) {
  const [thread, setThread] = useState<Message[]>([message]);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = message.campaign_lead_id
      ? `campaign_lead=${message.campaign_lead_id}`
      : `thread=${message.provider_thread_id ?? ""}`;
    fetch(`/api/messages/thread?${key}`)
      .then((r) => (r.ok ? r.json() : { messages: [message] }))
      .then((d) => setThread(d.messages?.length ? d.messages : [message]))
      .catch(() => {});
  }, [message]);

  async function sendReply() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/messages/${message.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setStatus("Reply sent — it will land in the same thread.");
      setReply("");
      if (data.message) setThread((t) => [...t, data.message]);
    } else {
      setStatus(`Failed: ${data.error}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/20" />
      <div
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-surface border-l border-border p-6 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold truncate">{message.subject}</h2>
          <button onClick={onClose} className="text-muted text-sm hover:text-ink">
            Close
          </button>
        </div>
        <div className="space-y-3 mb-6">
          {thread.map((m) => (
            <div
              key={m.id}
              className={`border border-border rounded-md p-3 text-sm ${
                m.direction === "outbound" ? "ml-8" : "mr-8"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span>
                  {m.direction === "outbound" ? "→" : "←"} {m.from_email}
                </span>
                <span>{new Date(m.occurred_at).toLocaleString("en-GB")}</span>
              </div>
              <pre className="whitespace-pre-wrap font-sans">{m.body ?? m.snippet}</pre>
            </div>
          ))}
        </div>
        <div>
          <Textarea
            rows={5}
            placeholder="Write a reply — it sends from the originating mailbox, in-thread."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="flex items-center gap-3 mt-2">
            <Button onClick={sendReply} disabled={!reply.trim() || busy}>
              {busy ? "Sending…" : "Send reply"}
            </Button>
            {status && <span className="text-xs text-muted">{status}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
