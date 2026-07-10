"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Chip, Empty, Input, Label, Select, Table, Th, Td, stateTone } from "@/components/ui";
import { temperatureOf, temperatureMeta, type Temperature } from "@/lib/temperature";
import type { ClState, ReplyCategory } from "@/lib/types";

interface Enrolment {
  id: string;
  state: ClState;
  current_step: number;
  next_send_at: string | null;
  stop_reason: string | null;
  created_at: string;
  campaigns: { id: string; name: string; settings: { contacts_key?: string } };
  leads: { id: string; email: string; first_name: string | null; last_name: string | null; company: string | null; title: string | null };
}
interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
}
interface MailboxRow {
  id: string;
  email: string;
  status: string;
}

export function ContactsClient({
  workspaceId,
  slug,
  enrolments,
  templates,
  mailboxes,
  lastCategory,
}: {
  workspaceId: string;
  slug: string;
  enrolments: Enrolment[];
  templates: TemplateRow[];
  mailboxes: MailboxRow[];
  lastCategory: Record<string, string>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Temperature | "all">("all");

  const rows = useMemo(
    () =>
      enrolments.map((e) => ({
        ...e,
        temperature: temperatureOf(e.state, (lastCategory[e.id] as ReplyCategory) ?? null),
      })),
    [enrolments, lastCategory]
  );
  const filtered = filter === "all" ? rows : rows.filter((r) => r.temperature === filter);
  const counts = useMemo(() => {
    const c: Record<Temperature, number> = { warm: 0, cold: 0, neutral: 0, rejected: 0 };
    for (const r of rows) c[r.temperature]++;
    return c;
  }, [rows]);

  return (
    <div className="space-y-6">
      <AddContactForm
        workspaceId={workspaceId}
        templates={templates}
        mailboxes={mailboxes.filter((m) => m.status === "active")}
        onAdded={() => router.refresh()}
      />

      <div className="flex gap-1.5 flex-wrap items-center">
        <FilterButton label={`All ${rows.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        {(Object.keys(temperatureMeta) as Temperature[]).map((t) => (
          <FilterButton
            key={t}
            label={`${temperatureMeta[t].label} ${counts[t]}`}
            active={filter === t}
            onClick={() => setFilter(t)}
          />
        ))}
        <span className="text-xs text-muted ml-2">
          Warm = interested/info request · Cold = no reply yet, sequence running · Neutral = not now / OOO ·
          Rejected = not interested / bounced / unsubscribed
        </span>
      </div>

      {filtered.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Contact</Th>
              <Th>Temperature</Th>
              <Th>Progress</Th>
              <Th>Next touch</Th>
              <Th>Cadence</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <ContactRow key={r.id} row={r} slug={slug} onChanged={() => router.refresh()} />
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>
          {rows.length
            ? "No contacts in this bucket."
            : "No contacts yet. Add one above — pick a template, set the cadence, and the engine handles the rest: sending, follow-ups, stop-on-reply, notifications."}
        </Empty>
      )}
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function cadenceFromKey(key?: string): string {
  // contacts_key = `${template_id}:${every_days}:${times}`
  const parts = key?.split(":") ?? [];
  if (parts.length !== 3) return "—";
  return `every ${parts[1]}d × ${parts[2]}`;
}

function ContactRow({
  row,
  slug,
  onChanged,
}: {
  row: Enrolment & { temperature: Temperature };
  slug: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const meta = temperatureMeta[row.temperature];
  const lead = row.leads;
  const stoppable = ["queued", "researching", "drafted", "awaiting_approval", "approved", "scheduled", "in_sequence"].includes(row.state);

  async function act(action: "stop" | "resume") {
    setBusy(true);
    await fetch(`/api/contacts/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    onChanged();
  }

  return (
    <tr>
      <Td>
        <div className="font-medium">
          {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email}
        </div>
        <div className="text-xs text-muted">
          {lead.email}
          {lead.company ? ` · ${lead.company}` : ""}
        </div>
      </Td>
      <Td>
        <Chip tone={meta.tone}>{meta.label}</Chip>
      </Td>
      <Td>
        <Chip tone={stateTone(row.state)}>{row.state.replace(/_/g, " ")}</Chip>
        <span className="text-xs text-muted ml-2">step {row.current_step}</span>
        {row.stop_reason && <div className="text-xs text-muted mt-1">{row.stop_reason}</div>}
      </Td>
      <Td>
        {row.next_send_at ? (
          <span className="text-xs tabular-nums">{new Date(row.next_send_at).toLocaleString("en-GB")}</span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </Td>
      <Td>
        <span className="text-xs text-muted">{cadenceFromKey(row.campaigns.settings?.contacts_key)}</span>
      </Td>
      <Td>
        <div className="flex gap-2 items-center">
          {row.state === "awaiting_approval" && (
            <Link href={`/w/${slug}/approvals`} className="text-xs text-primary hover:underline">
              Review draft
            </Link>
          )}
          {(row.temperature === "warm" || row.state === "replied") && (
            <Link href={`/w/${slug}/inbox`} className="text-xs text-secondary hover:underline">
              Open reply
            </Link>
          )}
          {stoppable && (
            <button className="text-xs text-danger hover:underline" onClick={() => act("stop")} disabled={busy}>
              Stop
            </button>
          )}
          {row.state === "paused" && (
            <button className="text-xs text-success hover:underline" onClick={() => act("resume")} disabled={busy}>
              Resume
            </button>
          )}
        </div>
      </Td>
    </tr>
  );
}

function AddContactForm({
  workspaceId,
  templates,
  mailboxes,
  onAdded,
}: {
  workspaceId: string;
  templates: TemplateRow[];
  mailboxes: MailboxRow[];
  onAdded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [everyDays, setEveryDays] = useState(3);
  const [times, setTimes] = useState(3);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const template = templates.find((t) => t.id === templateId);
  const usesAi = template ? /\{\{\s*ai_/.test(`${template.subject} ${template.body}`) : false;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        email,
        first_name: firstName,
        last_name: lastName,
        company,
        template_id: templateId,
        mailbox_id: mailboxId,
        every_days: everyDays,
        times,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setMsg(
        data.flow === "scheduled"
          ? "Added — first email is scheduled (jittered into the send window)."
          : "Added — researching now; the personalised draft will appear in Approvals for your yes."
      );
      setEmail("");
      setFirstName("");
      setLastName("");
      setCompany("");
      onAdded();
    } else {
      setMsg(`Failed: ${data.error}`);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold mb-4">Add a contact</h2>
      <form onSubmit={add} className="space-y-4">
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label>Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label>Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
        </div>
        <div className="grid md:grid-cols-4 gap-3 items-end">
          <div>
            <Label>Template *</Label>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
              <option value="">— choose —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Send from *</Label>
            <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} required>
              <option value="">— choose —</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Follow up every</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={30}
                className="w-20"
                value={everyDays}
                onChange={(e) => setEveryDays(Number(e.target.value))}
              />
              <span className="text-sm text-muted">days</span>
            </div>
          </div>
          <div>
            <Label>Total touches (incl. first)</Label>
            <Input
              type="number"
              min={1}
              max={6}
              className="w-20"
              value={times}
              onChange={(e) => setTimes(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" disabled={busy || !templateId || !mailboxId}>
            {busy ? "Adding…" : "Add & start sequence"}
          </Button>
          {template && (
            <span className="text-xs text-muted">
              {usesAi
                ? "This template has AI slots — the draft will wait for your approval before anything sends."
                : "Static template — sends as-is on the next window, follow-ups thread automatically."}
              {" "}Stops automatically the moment they reply, bounce or unsubscribe.
            </span>
          )}
          {msg && <span className={`text-sm ${msg.startsWith("Failed") ? "text-danger" : "text-success"}`}>{msg}</span>}
        </div>
      </form>
    </Card>
  );
}
