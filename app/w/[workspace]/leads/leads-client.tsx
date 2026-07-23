"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Chip, Empty, Input, Select, Table, Th, Td, stateTone } from "@/components/ui";
import { parseCsv } from "@/lib/csv";
import type { Lead } from "@/lib/types";

const FIELDS = ["email", "first_name", "last_name", "company", "title", "linkedin_url", "timezone", "— ignore —"] as const;

interface List {
  id: string;
  name: string;
}

export function LeadsClient({
  workspaceId,
  slug,
  lists,
  leads,
  activeList,
  activeTag,
  allTags,
}: {
  workspaceId: string;
  slug: string;
  lists: List[];
  leads: Lead[];
  activeList: string | null;
  activeTag: string | null;
  allTags: string[];
}) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [drawer, setDrawer] = useState<Lead | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState("");

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    setSelected(selected.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)));
  }
  async function applyTag(remove = false) {
    if (!tagInput.trim() || !selected.size) return;
    await fetch("/api/leads/tag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_ids: [...selected],
        [remove ? "remove" : "add"]: tagInput.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    setTagInput("");
    setSelected(new Set());
    router.refresh();
  }

  async function addToList(listId: string | null, newName?: string) {
    if (!selected.size) return;
    await fetch("/api/leads/tag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_ids: [...selected],
        list_id: listId ?? undefined,
        new_list_name: newName,
        workspace_id: workspaceId,
      }),
    });
    setSelected(new Set());
    router.refresh();
  }
  function goto(params: Record<string, string | null>) {
    const sp = new URLSearchParams();
    if (params.list ?? activeList) sp.set("list", (params.list ?? activeList)!);
    if (params.tag ?? (params.tag === null ? "" : activeTag)) {
      const t = params.tag === null ? "" : (params.tag ?? activeTag);
      if (t) sp.set("tag", t);
    }
    router.push(`/w/${slug}/leads${sp.toString() ? `?${sp}` : ""}`);
  }

  async function runVerification() {
    setVerifying(true);
    let remaining = 1;
    let total = 0;
    while (remaining > 0) {
      const res = await fetch("/api/leads/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, list_id: activeList }),
      });
      if (!res.ok) {
        setVerifyStatus("Verification error — see logs");
        break;
      }
      const data = await res.json();
      total += data.verified;
      remaining = data.remaining;
      setVerifyStatus(`Verified ${total}, ${remaining} remaining…`);
      if (data.verified === 0 && remaining > 0) break; // avoid spinning on persistent failures
    }
    setVerifying(false);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Select
          value={activeList ?? ""}
          onChange={(e) =>
            router.push(`/w/${slug}/leads${e.target.value ? `?list=${e.target.value}` : ""}`)
          }
        >
          <option value="">All lists</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Button onClick={() => setShowImport(true)}>Import CSV</Button>
        <Button variant="outline" onClick={runVerification} disabled={verifying}>
          {verifying ? "Verifying…" : "Verify unverified"}
        </Button>
        {verifyStatus && <span className="text-sm text-muted">{verifyStatus}</span>}
        <span className="ml-auto text-sm text-muted">{leads.length} leads shown</span>
      </div>

      {/* tag filter row (buckets) */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <span className="text-xs text-muted mr-1">Buckets:</span>
          <button
            onClick={() => goto({ tag: null })}
            className={`px-2.5 py-1 rounded-full text-xs border ${!activeTag ? "border-primary text-primary font-medium" : "border-border text-muted hover:text-ink"}`}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => goto({ tag: t })}
              className={`px-2.5 py-1 rounded-full text-xs border ${activeTag === t ? "border-primary text-primary font-medium" : "border-border text-muted hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* bulk tag action bar */}
      {selected.size > 0 && (
        <Card className="mb-4 !p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Input
              className="max-w-xs"
              placeholder="tag name(s), comma-separated"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
            />
            <Button onClick={() => applyTag(false)} disabled={!tagInput.trim()}>
              Add tag
            </Button>
            <Button variant="outline" onClick={() => applyTag(true)} disabled={!tagInput.trim()}>
              Remove tag
            </Button>
            <span className="text-muted text-xs mx-1">or</span>
            <Select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  const name = window.prompt("Name for the new list:");
                  if (name?.trim()) addToList(null, name.trim());
                } else if (e.target.value) {
                  addToList(e.target.value);
                }
                e.target.value = "";
              }}
            >
              <option value="">Add to list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="__new__">+ New list…</option>
            </Select>
            <button className="text-xs text-muted hover:text-ink ml-2" onClick={() => setSelected(new Set())}>
              clear selection
            </button>
          </div>
        </Card>
      )}

      {showImport && (
        <ImportWizard
          workspaceId={workspaceId}
          lists={lists}
          onClose={() => {
            setShowImport(false);
            router.refresh();
          }}
        />
      )}

      {leads.length ? (
        <Table>
          <thead>
            <tr>
              <Th>
                <input
                  type="checkbox"
                  checked={selected.size === leads.length && leads.length > 0}
                  onChange={toggleAll}
                  className="accent-[#B56FDC]"
                />
              </Th>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Company</Th>
              <Th>Buckets</Th>
              <Th>Verification</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="hover:bg-border/20">
                <Td>
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                    className="accent-[#B56FDC]"
                  />
                </Td>
                <Td>
                  <button className="hover:underline" onClick={() => setDrawer(l)}>
                    {l.email}
                  </button>
                </Td>
                <Td>{[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</Td>
                <Td>{l.company ?? "—"}</Td>
                <Td>
                  <div className="flex gap-1 flex-wrap">
                    {(l.tags ?? []).length ? (
                      l.tags.map((t) => (
                        <Chip key={t} tone="secondary">
                          {t}
                        </Chip>
                      ))
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                </Td>
                <Td>
                  <Chip tone={stateTone(l.verify_status)}>{l.verify_status}</Chip>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty icon="👥">
          {activeTag || activeList
            ? "No leads in this bucket."
            : "No leads yet. Import a CSV (Apollo, Sales Navigator, or any format) to get started."}
        </Empty>
      )}

      {drawer && <LeadDrawer lead={drawer} slug={slug} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function ImportWizard({
  workspaceId,
  lists,
  onClose,
}: {
  workspaceId: string;
  lists: List[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [listChoice, setListChoice] = useState("__new__");
  const [newListName, setNewListName] = useState("");
  const [importTags, setImportTags] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const header = rows[0] ?? [];
  const preview = rows.slice(1, 6);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result));
      setRows(parsed);
      // Smart auto-mapping — recognises Apollo, LinkedIn Sales Navigator
      // (Evaboot/Wiza/etc. exports), Hunter, Lusha and generic header names.
      setMapping(
        (parsed[0] ?? []).map((h) => {
          const n = h.toLowerCase().replace(/[^a-z]/g, "");
          // exact/known headers first (Apollo: "Person Linkedin Url", SalesNav tools: "profileUrl")
          if (["email", "workemail", "emailaddress", "verifiedemail", "prospectemail"].includes(n)) return "email";
          if (["firstname", "first"].includes(n)) return "first_name";
          if (["lastname", "last", "surname"].includes(n)) return "last_name";
          if (["company", "companyname", "organisation", "organization", "companyforemails", "currentcompany", "employer", "accountname"].includes(n)) return "company";
          if (["title", "jobtitle", "position", "role", "headline", "currenttitle"].includes(n)) return "title";
          if (["personlinkedinurl", "linkedinurl", "linkedin", "profileurl", "linkedinprofile", "linkedinprofileurl", "publicprofileurl"].includes(n)) return "linkedin_url";
          if (["timezone", "tz"].includes(n)) return "timezone";
          // fuzzy fallback
          if (n.includes("email")) return "email";
          if (n.includes("first")) return "first_name";
          if (n.includes("last")) return "last_name";
          if (n.includes("company") || n.includes("organi")) return "company";
          if (n.includes("title") || n.includes("position")) return "title";
          if (n.includes("linkedin") || n.includes("profileurl")) return "linkedin_url";
          return "— ignore —";
        })
      );
    };
    reader.readAsText(file);
  }

  const canImport = useMemo(
    () => rows.length > 1 && mapping.includes("email") && (listChoice !== "__new__" || newListName),
    [rows, mapping, listChoice, newListName]
  );

  async function doImport() {
    setBusy(true);
    const mapped = rows.slice(1).map((r) => {
      const obj: Record<string, unknown> = { custom: {} as Record<string, unknown> };
      mapping.forEach((field, i) => {
        const v = r[i]?.trim();
        if (!v) return;
        if (field === "— ignore —") return;
        if (FIELDS.includes(field as (typeof FIELDS)[number])) obj[field] = v;
      });
      // unmapped columns → custom
      mapping.forEach((field, i) => {
        if (field === "— ignore —" && header[i] && r[i]?.trim()) {
          (obj.custom as Record<string, unknown>)[header[i]] = r[i].trim();
        }
      });
      return obj;
    });
    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        list_id: listChoice !== "__new__" ? listChoice : undefined,
        new_list_name: listChoice === "__new__" ? newListName : undefined,
        tags: importTags.split(",").map((t) => t.trim()).filter(Boolean),
        rows: mapped,
      }),
    });
    const data = await res.json();
    setBusy(false);
    setResult(
      res.ok
        ? `Imported ${data.imported}, skipped ${data.skipped} (duplicates/invalid).`
        : `Failed: ${data.error}`
    );
  }

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">Import CSV</h2>
        <button onClick={onClose} className="text-muted text-sm hover:text-ink">
          Close
        </button>
      </div>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Works with exports from <strong>Apollo</strong>, <strong>LinkedIn Sales Navigator</strong> (via
          Evaboot/Wiza/etc.), Hunter, Lusha or any CSV — columns are matched automatically, and anything
          unmatched is kept as a custom field you can use as {"{{tags}}"} in templates.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        {rows.length > 1 && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
                <option value="__new__">New list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
              {listChoice === "__new__" && (
                <Input
                  className="max-w-xs"
                  placeholder="List name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                />
              )}
              <Input
                className="max-w-xs"
                placeholder="tag this batch (e.g. saas, london)"
                value={importTags}
                onChange={(e) => setImportTags(e.target.value)}
              />
              <span className="text-sm text-muted">{rows.length - 1} rows</span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead>
                  <tr>
                    {header.map((h, i) => (
                      <th key={i} className="text-left px-2 py-1 border-b border-border">
                        <div className="text-muted font-normal text-xs mb-1">{h}</div>
                        <Select
                          value={mapping[i]}
                          onChange={(e) => {
                            const m = [...mapping];
                            m[i] = e.target.value;
                            setMapping(m);
                          }}
                        >
                          {FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className="px-2 py-1 border-b border-border text-muted">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={doImport} disabled={!canImport || busy}>
                {busy ? "Importing…" : "Import"}
              </Button>
              {result && <span className="text-sm text-muted">{result}</span>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function LeadDrawer({ lead, slug, onClose }: { lead: Lead; slug: string; onClose: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    first_name: lead.first_name || "",
    last_name: lead.last_name || "",
    company: lead.company || "",
    title: lead.title || "",
    linkedin_url: lead.linkedin_url || "",
    timezone: lead.timezone || "",
  });
  const [busy, setBusy] = useState(false);

  async function saveLead() {
    if (!isEditing) return;
    setBusy(true);
    await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    setBusy(false);
    setIsEditing(false);
    // In real app, would refresh or optimistically update
    window.location.reload();
  }

  async function deleteLead() {
    if (!confirm("Delete this lead? This cannot be undone.")) return;
    const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
    if (res.ok) {
      onClose();
      window.location.reload();
    }
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/20" />
      <div
        className="absolute right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border p-6 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold">{lead.email}</h2>
          <button onClick={onClose} className="text-muted text-sm hover:text-ink">
            Close
          </button>
        </div>

        <div className="space-y-3 text-sm mb-6">
          {isEditing ? (
            <>
              <div>
                <label className="text-xs text-muted block mb-1">First name</label>
                <Input
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Last name</label>
                <Input
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Company</label>
                <Input
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Title</label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">LinkedIn URL</label>
                <Input
                  value={formData.linkedin_url}
                  onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Timezone</label>
                <Input
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  placeholder="e.g. America/New_York"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={saveLead} disabled={busy}>
                  {busy ? "…" : "Save"}
                </Button>
                <Button variant="ghost" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <dl className="space-y-3">
                {(
                  [
                    ["Name", [lead.first_name, lead.last_name].filter(Boolean).join(" ")],
                    ["Company", lead.company],
                    ["Domain", lead.domain],
                    ["Title", lead.title],
                    ["LinkedIn", lead.linkedin_url],
                    ["Timezone", lead.timezone],
                    ["Tags", (lead.tags ?? []).join(", ")],
                    ["Verification", `${lead.verify_status} (${lead.verify_provider ?? "—"})`],
                  ] as [string, string | null | undefined][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted text-xs">{k}</dt>
                    <dd className="font-medium">{v || "—"}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex gap-2 pt-3 border-t border-border">
                <Button onClick={() => setIsEditing(true)} variant="outline">
                  Edit
                </Button>
                <Button onClick={deleteLead} variant="danger">
                  Delete
                </Button>
              </div>
            </>
          )}
        </div>

        {Object.keys(lead.custom ?? {}).length > 0 && (
          <div className="mt-6">
            <dt className="text-muted text-xs mb-1">Custom fields</dt>
            <pre className="text-xs bg-bg border border-border rounded p-2 overflow-x-auto">
              {JSON.stringify(lead.custom, null, 2)}
            </pre>
          </div>
        )}

        <LeadResearchPanel leadId={lead.id} />

        <div className="mt-6 pt-6 border-t border-border">
          <Link href={`/w/${slug}/inbox?lead=${lead.id}`} className="text-sm text-secondary hover:underline">
            View conversation timeline →
          </Link>
        </div>
      </div>
    </div>
  );
}

function LeadResearchPanel({ leadId }: { leadId: string }) {
  const [brief, setBrief] = useState<Record<string, unknown> | null | "loading" | "none">("loading");

  useMemo(() => {
    fetch(`/api/leads/${leadId}/research`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrief(d?.brief ?? "none"))
      .catch(() => setBrief("none"));
  }, [leadId]);

  if (brief === "loading") return <p className="text-xs text-muted mt-6">Loading research…</p>;
  if (brief === "none" || !brief) return <p className="text-xs text-muted mt-6">No research brief yet.</p>;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium mb-2">Research brief</h3>
      <pre className="text-xs bg-bg border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(brief, null, 2)}
      </pre>
    </div>
  );
}
