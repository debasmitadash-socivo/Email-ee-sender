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
}: {
  workspaceId: string;
  slug: string;
  lists: List[];
  leads: Lead[];
  activeList: string | null;
}) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [drawer, setDrawer] = useState<Lead | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);

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
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Company</Th>
              <Th>Title</Th>
              <Th>Verification</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="hover:bg-border/20 cursor-pointer" onClick={() => setDrawer(l)}>
                <Td>{l.email}</Td>
                <Td>{[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</Td>
                <Td>{l.company ?? "—"}</Td>
                <Td>{l.title ?? "—"}</Td>
                <Td>
                  <Chip tone={stateTone(l.verify_status)}>{l.verify_status}</Chip>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>No leads yet. Import a CSV to get started.</Empty>
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
        <dl className="space-y-3 text-sm">
          {(
            [
              ["Name", [lead.first_name, lead.last_name].filter(Boolean).join(" ")],
              ["Company", lead.company],
              ["Domain", lead.domain],
              ["Title", lead.title],
              ["LinkedIn", lead.linkedin_url],
              ["Timezone", lead.timezone],
              ["Verification", `${lead.verify_status} (${lead.verify_provider ?? "—"})`],
            ] as [string, string | null | undefined][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted text-xs">{k}</dt>
              <dd>{v || "—"}</dd>
            </div>
          ))}
          {Object.keys(lead.custom ?? {}).length > 0 && (
            <div>
              <dt className="text-muted text-xs">Custom fields</dt>
              <dd>
                <pre className="text-xs bg-bg border border-border rounded p-2 mt-1 overflow-x-auto">
                  {JSON.stringify(lead.custom, null, 2)}
                </pre>
              </dd>
            </div>
          )}
        </dl>
        <LeadResearchPanel leadId={lead.id} />
        <div className="mt-6">
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
