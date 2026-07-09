"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Input, Label, Select, Textarea, stateTone } from "@/components/ui";
import type { Campaign, CampaignSettings, SequenceStep } from "@/lib/types";

const TABS = ["Sequence", "Audience", "Schedule", "Settings", "Review"] as const;
type Tab = (typeof TABS)[number];

interface StepDraft {
  step_no: number;
  variant: string;
  delay_days: number;
  subject: string;
  body: string;
}

export function CampaignBuilder(props: {
  campaign: Campaign;
  steps: SequenceStep[];
  attachedMailboxIds: string[];
  mailboxes: { id: string; email: string; provider: string; status: string }[];
  lists: { id: string; name: string }[];
  audienceCount: number;
  stateCounts: Record<string, number>;
  slug: string;
}) {
  const router = useRouter();
  const { campaign } = props;
  const [tab, setTab] = useState<Tab>("Sequence");
  const [steps, setSteps] = useState<StepDraft[]>(
    props.steps.length
      ? props.steps.map((s) => ({
          step_no: s.step_no,
          variant: s.variant,
          delay_days: s.delay_days,
          subject: s.subject ?? "",
          body: s.body,
        }))
      : [{ step_no: 1, variant: "A", delay_days: 0, subject: "", body: "" }]
  );
  const [settings, setSettings] = useState<CampaignSettings>(campaign.settings ?? {});
  const [mailboxIds, setMailboxIds] = useState<string[]>(props.attachedMailboxIds);
  const [listId, setListId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [launchFailures, setLaunchFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ReviewPreview[] | null>(null);

  async function saveSteps() {
    setBusy("steps");
    const res = await fetch(`/api/campaigns/${campaign.id}/steps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    setBusy(null);
    setMsg(res.ok ? "Sequence saved." : "Save failed.");
  }

  async function saveSettings(patch: Partial<CampaignSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: next }),
    });
  }

  async function saveAudience() {
    setBusy("audience");
    const res = await fetch(`/api/campaigns/${campaign.id}/audience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailbox_ids: mailboxIds, list_id: listId || undefined }),
    });
    const data = await res.json();
    setBusy(null);
    setMsg(res.ok ? `Audience updated (+${data.added} leads).` : `Failed: ${data.error}`);
    router.refresh();
  }

  async function loadReview() {
    setBusy("review");
    const res = await fetch(`/api/campaigns/${campaign.id}/review`);
    const data = await res.json();
    setReviewData(data.previews ?? []);
    setBusy(null);
  }

  async function launch() {
    setBusy("launch");
    setLaunchFailures([]);
    const res = await fetch(`/api/campaigns/${campaign.id}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok) {
      setMsg(`Launched — ${data.scheduled} leads ${data.uses_ai ? "queued for research + drafting" : "scheduled"}.`);
      router.refresh();
    } else {
      setLaunchFailures(data.failures ?? [data.error]);
    }
  }

  async function setStatus(status: string) {
    await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function seedTest() {
    setBusy("seed");
    const res = await fetch(`/api/campaigns/${campaign.id}/seed-test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await res.json();
    setBusy(null);
    setMsg(res.ok ? `Seed test: ${JSON.stringify(data.results)}` : `Seed test failed: ${data.error}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{campaign.name}</h1>
          <Chip tone={stateTone(campaign.status)}>{campaign.status}</Chip>
          <span className="text-sm text-muted">{props.audienceCount} leads</span>
          {Object.entries(props.stateCounts).map(([s, n]) => (
            <Chip key={s} tone={stateTone(s)}>
              {s} {n}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={seedTest} disabled={busy === "seed"}>
            {busy === "seed" ? "…" : "Seed test"}
          </Button>
          {campaign.status === "running" ? (
            <Button variant="outline" onClick={() => setStatus("paused")}>
              Pause
            </Button>
          ) : campaign.status === "paused" ? (
            <Button onClick={() => setStatus("running")}>Resume</Button>
          ) : (
            <Button onClick={launch} disabled={busy === "launch"}>
              {busy === "launch" ? "Checking launch gate…" : "Launch"}
            </Button>
          )}
        </div>
      </div>

      {msg && <p className="text-sm text-muted mb-4">{msg}</p>}
      {launchFailures.length > 0 && (
        <Card className="mb-6 border-danger">
          <h3 className="text-sm font-semibold text-danger mb-2">Launch gate blocked:</h3>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {launchFailures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "Review") loadReview();
            }}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Sequence" && (
        <div className="space-y-4">
          {steps.map((s, i) => (
            <Card key={i}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 text-sm font-medium">
                  Step {s.step_no} · Variant {s.variant}
                  {s.step_no > 1 && (
                    <span className="flex items-center gap-1 font-normal text-muted">
                      after
                      <Input
                        type="number"
                        min={1}
                        className="w-16 py-1"
                        value={s.delay_days}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = { ...s, delay_days: Number(e.target.value) };
                          setSteps(next);
                        }}
                      />
                      days
                    </span>
                  )}
                </div>
                <button
                  className="text-xs text-danger hover:underline"
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <Label>
                    Subject {s.step_no > 1 && <span className="text-muted font-normal">(blank = same thread, Re:)</span>}
                  </Label>
                  <Input
                    value={s.subject}
                    onChange={(e) => {
                      const next = [...steps];
                      next[i] = { ...s, subject: e.target.value };
                      setSteps(next);
                    }}
                    placeholder={s.step_no === 1 ? "Required for step 1" : "(same thread)"}
                  />
                </div>
                <div>
                  <Label>Body</Label>
                  <Textarea
                    rows={8}
                    value={s.body}
                    onChange={(e) => {
                      const next = [...steps];
                      next[i] = { ...s, body: e.target.value };
                      setSteps(next);
                    }}
                    placeholder={"Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nSupports {{vars}}, {spintax|spin tax} and {{ai_slots}}."}
                  />
                </div>
              </div>
            </Card>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setSteps([
                  ...steps,
                  {
                    step_no: Math.max(...steps.map((s) => s.step_no), 0) + 1,
                    variant: "A",
                    delay_days: 3,
                    subject: "",
                    body: "",
                  },
                ])
              }
            >
              Add step
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const step1 = steps.find((s) => s.step_no === 1 && s.variant === "A");
                if (step1 && !steps.some((s) => s.step_no === 1 && s.variant === "B")) {
                  setSteps([...steps, { ...step1, variant: "B" }]);
                }
              }}
            >
              Add B variant (step 1)
            </Button>
            <Button onClick={saveSteps} disabled={busy === "steps"}>
              {busy === "steps" ? "…" : "Save sequence"}
            </Button>
          </div>
          <p className="text-xs text-muted">
            Variables: {"{{first_name}} {{last_name}} {{company}} {{title}} {{domain}}"} + any custom CSV
            column. AI slots: {"{{ai_icebreaker}}"} etc. — define instructions on the template or leave the
            writer to use the knowledge profile. Spintax: {"{option a|option b}"}.
          </p>
        </div>
      )}

      {tab === "Audience" && (
        <Card>
          <div className="space-y-4 max-w-lg">
            <div>
              <Label>Sending mailboxes (rotated round-robin)</Label>
              <div className="space-y-2 mt-2">
                {props.mailboxes.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={mailboxIds.includes(m.id)}
                      onChange={(e) =>
                        setMailboxIds(
                          e.target.checked ? [...mailboxIds, m.id] : mailboxIds.filter((x) => x !== m.id)
                        )
                      }
                      className="accent-[#B56FDC]"
                    />
                    {m.email} <Chip tone={stateTone(m.status)}>{m.status}</Chip>
                  </label>
                ))}
                {!props.mailboxes.length && <p className="text-sm text-muted">Connect a mailbox first.</p>}
              </div>
            </div>
            <div>
              <Label>Add leads from list (invalid-verification leads are excluded)</Label>
              <Select value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">— choose a list —</option>
                {props.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={saveAudience} disabled={busy === "audience"}>
              {busy === "audience" ? "…" : "Save audience"}
            </Button>
            <p className="text-sm text-muted">Currently {props.audienceCount} leads in this campaign.</p>
          </div>
        </Card>
      )}

      {tab === "Schedule" && (
        <Card>
          <div className="space-y-4 max-w-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Window start</Label>
                <Input
                  type="time"
                  value={settings.send_window?.start ?? "08:30"}
                  onChange={(e) =>
                    saveSettings({
                      send_window: { ...(settings.send_window ?? { end: "17:30", days: [1, 2, 3, 4, 5] }), start: e.target.value } as CampaignSettings["send_window"],
                    })
                  }
                />
              </div>
              <div>
                <Label>Window end</Label>
                <Input
                  type="time"
                  value={settings.send_window?.end ?? "17:30"}
                  onChange={(e) =>
                    saveSettings({
                      send_window: { ...(settings.send_window ?? { start: "08:30", days: [1, 2, 3, 4, 5] }), end: e.target.value } as CampaignSettings["send_window"],
                    })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Days</Label>
              <div className="flex gap-2 mt-1">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
                  const day = i + 1;
                  const days = settings.send_window?.days ?? [1, 2, 3, 4, 5];
                  const on = days.includes(day);
                  return (
                    <button
                      key={d}
                      onClick={() =>
                        saveSettings({
                          send_window: {
                            ...(settings.send_window ?? { start: "08:30", end: "17:30" }),
                            days: on ? days.filter((x) => x !== day) : [...days, day].sort(),
                          } as CampaignSettings["send_window"],
                        })
                      }
                      className={`px-2.5 py-1 rounded text-xs border ${on ? "border-primary text-primary font-medium" : "border-border text-muted"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Timezone mode</Label>
                <Select
                  value={settings.timezone_mode ?? "fixed"}
                  onChange={(e) => saveSettings({ timezone_mode: e.target.value as "lead" | "fixed" })}
                >
                  <option value="fixed">Fixed timezone</option>
                  <option value="lead">Lead's timezone (fallback fixed)</option>
                </Select>
              </div>
              <div>
                <Label>Fixed timezone</Label>
                <Input
                  value={settings.fixed_tz ?? "Europe/London"}
                  onChange={(e) => saveSettings({ fixed_tz: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted">
              Sends are jittered 2–9 minutes apart and never go out before 06:00 or after 21:00 in the lead's
              local time, regardless of this window.
            </p>
          </div>
        </Card>
      )}

      {tab === "Settings" && (
        <Card>
          <div className="space-y-3 max-w-lg text-sm">
            {(
              [
                ["plain_text", "Plain-text emails (recommended for deliverability)"],
                ["track_opens", "Track opens (adds a pixel; HTML mode only; unreliable by nature)"],
                ["track_clicks", "Track clicks (wraps links; HTML mode only)"],
                ["linkedin_enrichment", "LinkedIn enrichment via Apify (only within free credits)"],
                ["allow_free_domains", "Allow sending to free consumer domains (gmail.com etc.)"],
                ["us_targeting", "US targeting (adds postal address to footer — CAN-SPAM)"],
              ] as [keyof CampaignSettings, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!settings[key]}
                  onChange={(e) => saveSettings({ [key]: e.target.checked })}
                  className="accent-[#B56FDC]"
                />
                {label}
              </label>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <Label>Approve first</Label>
              <Input
                type="number"
                min={0}
                className="w-20"
                value={settings.approve_first_n ?? 10}
                onChange={(e) => saveSettings({ approve_first_n: Number(e.target.value) })}
              />
              <span className="text-muted">AI drafts, then auto-approve</span>
            </div>
            <div className="flex items-center gap-2">
              <Label>Daily cap per recipient domain</Label>
              <Input
                type="number"
                min={1}
                className="w-20"
                value={settings.daily_domain_cap ?? 5}
                onChange={(e) => saveSettings({ daily_domain_cap: Number(e.target.value) })}
              />
            </div>
          </div>
        </Card>
      )}

      {tab === "Review" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            10 randomly-picked real leads rendered through every step. Review before launch — the launch gate
            requires the sequence, mailboxes, DNS and audience to pass.
          </p>
          {busy === "review" && <p className="text-sm text-muted">Rendering…</p>}
          {reviewData?.map((p, i) => (
            <Card key={i}>
              <div className="text-sm font-medium mb-3">
                {p.lead.name || p.lead.email} <span className="text-muted font-normal">({p.lead.email})</span>
              </div>
              {p.steps.map((s) => (
                <div key={s.step_no} className="mb-4 border-l-2 border-border pl-4">
                  <div className="text-xs text-muted mb-1">
                    Step {s.step_no} — subject: <span className="text-ink">{s.subject}</span>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap">{s.body}</pre>
                  {s.missing_vars.length > 0 && (
                    <p className="text-xs text-danger mt-1">Missing vars: {s.missing_vars.join(", ")}</p>
                  )}
                  {s.ai_slots_pending.length > 0 && (
                    <p className="text-xs text-secondary mt-1">
                      AI slots (filled at draft time): {s.ai_slots_pending.join(", ")}
                    </p>
                  )}
                  {s.lint.map((l, j) => (
                    <p key={j} className={`text-xs mt-1 ${l.level === "error" ? "text-danger" : "text-warn"}`}>
                      {l.level}: {l.detail}
                    </p>
                  ))}
                </div>
              ))}
            </Card>
          ))}
          {reviewData && !reviewData.length && (
            <p className="text-sm text-muted">No leads in the audience yet — add some first.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface ReviewPreview {
  lead: { email: string; name: string };
  steps: {
    step_no: number;
    subject: string;
    body: string;
    missing_vars: string[];
    ai_slots_pending: string[];
    lint: { level: string; detail: string }[];
  }[];
}
