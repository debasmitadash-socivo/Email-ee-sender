"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import type { KnowledgeProfile } from "@/lib/types";

export function KnowledgeForm({
  workspaceId,
  profile: initial,
}: {
  workspaceId: string;
  profile: KnowledgeProfile;
}) {
  const supabase = createClient();
  const [p, setP] = useState<KnowledgeProfile>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAutofill, setShowAutofill] = useState(false);
  const [companyInfo, setCompanyInfo] = useState("");
  const [website, setWebsite] = useState("");
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [autofillMsg, setAutofillMsg] = useState<string | null>(null);

  function set<K extends keyof KnowledgeProfile>(key: K, value: KnowledgeProfile[K]) {
    setP({ ...p, [key]: value });
  }

  async function autofill() {
    setAutofillBusy(true);
    setAutofillMsg(null);
    const res = await fetch("/api/knowledge/autofill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, company_info: companyInfo, website }),
    });
    const data = await res.json();
    setAutofillBusy(false);
    if (!res.ok) {
      setAutofillMsg(data.error);
      return;
    }
    const filled = data.profile as Partial<KnowledgeProfile>;
    setP({
      ...p,
      what_we_sell: filled.what_we_sell || p.what_we_sell,
      offer: filled.offer || p.offer,
      icp: filled.icp || p.icp,
      pains: filled.pains?.length ? filled.pains : p.pains,
      proof_points: filled.proof_points?.length ? filled.proof_points : p.proof_points,
      tone_rules: filled.tone_rules || p.tone_rules,
      sender_name: filled.sender_name || p.sender_name,
    });
    setAutofillMsg("Filled below — review and edit before saving, then click Save profile.");
    setShowAutofill(false);
  }

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("knowledge")
      .upsert({ workspace_id: workspaceId, profile: p as Record<string, unknown>, updated_at: new Date().toISOString() });
    setBusy(false);
    setMsg(error ? `Failed: ${error.message}` : "Saved.");
  }

  const textField = (key: keyof KnowledgeProfile, label: string, rows = 2, hint?: string) => (
    <div>
      <Label>{label}</Label>
      <Textarea
        rows={rows}
        value={(p[key] as string) ?? ""}
        onChange={(e) => set(key, e.target.value as never)}
      />
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );

  const listField = (key: "pains" | "proof_points" | "banned_phrases" | "seed_emails", label: string, hint?: string) => (
    <div>
      <Label>{label}</Label>
      <Textarea
        rows={3}
        value={((p[key] as string[]) ?? []).join("\n")}
        onChange={(e) => set(key, e.target.value.split("\n").filter(Boolean) as never)}
      />
      <p className="text-xs text-muted mt-1">{hint ?? "One per line."}</p>
    </div>
  );

  return (
    <Card className="max-w-2xl">
      <div className="space-y-4">
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
          {!showAutofill ? (
            <div className="flex items-center justify-between">
              <p className="text-sm">
                <span className="font-medium">Fill this from AI</span> — paste a company description or a
                website URL and let AI draft the fields below.
              </p>
              <Button variant="outline" onClick={() => setShowAutofill(true)}>
                Autofill with AI
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Label>Website (optional)</Label>
              <Input placeholder="socivo.co.uk" value={website} onChange={(e) => setWebsite(e.target.value)} />
              <Label>Or paste a company description</Label>
              <Textarea
                rows={4}
                placeholder="What you do, who you sell to, any proof points (client count, case studies)…"
                value={companyInfo}
                onChange={(e) => setCompanyInfo(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button onClick={autofill} disabled={autofillBusy || (!website && !companyInfo)}>
                  {autofillBusy ? "Reading & drafting…" : "Generate"}
                </Button>
                <Button variant="ghost" onClick={() => setShowAutofill(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted">
                Only states facts you give it — it won't invent proof points or numbers. Fills the fields
                below for you to review and edit before saving.
              </p>
            </div>
          )}
          {autofillMsg && <p className="text-xs text-muted mt-2">{autofillMsg}</p>}
        </div>
        {textField("what_we_sell", "What we sell", 2)}
        {textField("offer", "The offer (what the email proposes)", 2)}
        {textField("icp", "Ideal customer profile", 2)}
        {listField("pains", "Pains we solve")}
        {listField("proof_points", "Proof points", "One per line — the writer can cite these.")}
        {textField("tone_rules", "Tone rules", 3, "e.g. 'Dry, direct, no adjectives. Short sentences.'")}
        {listField("banned_phrases", "Banned phrases", "Never appear in generated copy (adds to the global list).")}
        <div>
          <Label>Sender name</Label>
          <Input value={p.sender_name ?? ""} onChange={(e) => set("sender_name", e.target.value)} />
        </div>
        {textField(
          "footer_identity",
          "Footer identity (required for compliance — appears in every email)",
          2,
          "e.g. 'Jane Doe · Socivo Ltd · London · socivo.co.uk'"
        )}
        {textField("postal_address", "Postal address (added for US-targeting campaigns — CAN-SPAM)", 2)}
        {listField("seed_emails", "Seed test inboxes", "Your own test Gmail/Outlook addresses for seed sends.")}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy ? "…" : "Save profile"}
          </Button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
