"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Empty, Input, stateTone } from "@/components/ui";
import type { Mailbox } from "@/lib/types";
import type { DnsCheckResult } from "@/lib/dns";
import { effectiveCap, HARD_MAX_DAILY_CAP } from "@/config/ramp";

export function MailboxList({ mailboxes }: { mailboxes: Mailbox[] }) {
  if (!mailboxes.length) {
    return (
      <Empty>
        No mailboxes connected yet. Connect a Gmail or Outlook inbox to start sending. Sending always
        happens from your own inboxes via the provider APIs — never SMTP.
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      {mailboxes.map((m) => (
        <MailboxCard key={m.id} mailbox={m} />
      ))}
    </div>
  );
}

function MailboxCard({ mailbox }: { mailbox: Mailbox }) {
  const router = useRouter();
  const [cap, setCap] = useState(mailbox.daily_cap);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [dns, setDns] = useState<DnsCheckResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const domain = mailbox.email.split("@")[1];
  const todayCap = effectiveCap(mailbox.ramp_started_at, mailbox.daily_cap);

  async function patch(body: Record<string, unknown>) {
    setBusy("patch");
    await fetch(`/api/mailboxes/${mailbox.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    router.refresh();
  }

  async function testSend() {
    setBusy("test");
    setTestMsg(null);
    const res = await fetch(`/api/mailboxes/${mailbox.id}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testTo }),
    });
    const data = await res.json();
    setTestMsg(res.ok ? "Test email sent ✓" : `Failed: ${data.error}`);
    setBusy(null);
  }

  async function runDns() {
    setBusy("dns");
    const res = await fetch(`/api/dns-check?domain=${domain}&provider=${mailbox.provider}`);
    setDns(await res.json());
    setBusy(null);
  }

  return (
    <Card>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-medium">{mailbox.email}</div>
          <div className="text-xs text-muted mt-0.5">
            {mailbox.provider === "google" ? "Gmail API" : "Microsoft Graph"} · ramp cap today {todayCap}
            /day · sent today {mailbox.sent_today} · health {mailbox.health_score}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={stateTone(mailbox.status)}>{mailbox.status}</Chip>
          <Button
            variant="outline"
            onClick={() => patch({ status: mailbox.status === "paused" ? "active" : "paused" })}
            disabled={busy === "patch"}
          >
            {mailbox.status === "paused" ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mt-6">
        <div>
          <div className="text-sm font-medium mb-2">Daily cap (max {HARD_MAX_DAILY_CAP})</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={HARD_MAX_DAILY_CAP}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
              onMouseUp={() => patch({ daily_cap: cap })}
              onTouchEnd={() => patch({ daily_cap: cap })}
              className="w-full accent-[#B56FDC]"
            />
            <span className="text-sm tabular-nums w-8">{cap}</span>
          </div>
          <p className="text-xs text-muted mt-2">
            Warm-up ramp applies automatically: wk1 8/day, wk2 15, wk3 25, then your cap.
          </p>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Send test email</div>
          <div className="flex gap-2">
            <Input
              placeholder="you@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button variant="outline" onClick={testSend} disabled={!testTo || busy === "test"}>
              {busy === "test" ? "…" : "Send"}
            </Button>
          </div>
          {testMsg && (
            <p className={`text-xs mt-2 ${testMsg.startsWith("Failed") ? "text-danger" : "text-success"}`}>
              {testMsg}
            </p>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">DNS ({domain})</div>
          <Button variant="outline" onClick={runDns} disabled={busy === "dns"}>
            {busy === "dns" ? "Checking…" : "Run SPF / DKIM / DMARC check"}
          </Button>
          {dns && (
            <ul className="mt-3 space-y-2 text-xs">
              {(["spf", "dkim", "dmarc"] as const).map((k) => (
                <li key={k}>
                  <span className="font-medium uppercase">{k}</span>{" "}
                  {dns[k].pass ? (
                    <span className="text-success">pass</span>
                  ) : (
                    <>
                      <span className="text-danger">fail</span>
                      <p className="text-muted mt-1">{dns[k].fix}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SignatureEditor mailbox={mailbox} onSaved={() => router.refresh()} />
    </Card>
  );
}

function SignatureEditor({ mailbox, onSaved }: { mailbox: Mailbox; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(
    mailbox.signature_html ? mailbox.signature_html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "") : ""
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const signature_html = text
      .split("\n")
      .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
      .join("<br>");
    const res = await fetch(`/api/mailboxes/${mailbox.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature_html }),
    });
    setBusy(false);
    setMsg(res.ok ? "Saved." : "Failed to save.");
    if (res.ok) onSaved();
  }

  if (!open) {
    return (
      <button
        className="text-xs text-secondary hover:underline mt-4"
        onClick={() => setOpen(true)}
      >
        {mailbox.signature_html ? "Edit closing signature" : "+ Add closing signature"}
      </button>
    );
  }
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="text-sm font-medium mb-2">Closing signature</div>
      <p className="text-xs text-muted mb-2">
        Appended after every email body, before the compliance footer (unsubscribe + identity). Plain
        text, one line per line — e.g. your name, title, phone. HTML emails only (no effect in plain-text
        mode).
      </p>
      <textarea
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Debasmita Dash\nFounder, Socivo\n+44 ..."}
      />
      <div className="flex items-center gap-3 mt-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "…" : "Save signature"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  );
}
