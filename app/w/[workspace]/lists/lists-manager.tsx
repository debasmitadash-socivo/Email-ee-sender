"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Chip, Input } from "@/components/ui";

interface List {
  id: string;
  name: string;
  created_at: string;
  count: number;
}

export function ListsManager({
  workspaceId,
  slug,
  lists,
  tagCounts,
  totalLeads,
}: {
  workspaceId: string;
  slug: string;
  lists: List[];
  tagCounts: Record<string, number>;
  totalLeads: number;
}) {
  const router = useRouter();
  const [newListName, setNewListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tags = Object.keys(tagCounts).sort();

  async function createList() {
    if (!newListName.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/leads/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, name: newListName }),
    });
    setBusy(false);
    if (res.ok) {
      setNewListName("");
      router.refresh();
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
  }

  async function deleteList(listId: string) {
    if (!confirm("Delete this list? Leads keep their data — they just lose the list assignment.")) return;
    const res = await fetch(`/api/leads/lists/${listId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="text-sm font-medium mb-3">Create new list</div>
        <div className="flex gap-2 max-w-xl">
          <Input
            placeholder="e.g. Q3 UK SaaS founders, Apollo import July"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createList()}
          />
          <Button onClick={createList} disabled={busy || !newListName.trim()}>
            {busy ? "…" : "Create"}
          </Button>
        </div>
        {msg && <p className="text-xs text-danger mt-2">{msg}</p>}
        <p className="text-xs text-muted mt-2">
          A list is a fixed group of leads — usually one per campaign or per import. Add leads to it from the
          Leads page (select leads → &quot;Add to list…&quot;), or pick the list during CSV import.
        </p>
      </Card>

      <Card>
        <div className="text-sm font-medium mb-4">
          Lists ({lists.length}) · {totalLeads} leads total
        </div>
        {lists.length === 0 ? (
          <p className="text-sm text-muted">No lists yet. Create one above, then add leads to it from the Leads page.</p>
        ) : (
          <div className="space-y-2">
            {lists.map((list) => (
              <div key={list.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded-md">
                <div className="flex-1 min-w-0">
                  <Link href={`/w/${slug}/leads?list=${list.id}`} className="text-sm font-medium hover:underline">
                    {list.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {list.count} lead{list.count === 1 ? "" : "s"} · created{" "}
                    {new Date(list.created_at).toLocaleDateString("en-GB")}
                  </div>
                </div>
                <Link href={`/w/${slug}/leads?list=${list.id}`} className="text-xs text-secondary hover:underline">
                  View leads
                </Link>
                <button onClick={() => deleteList(list.id)} className="text-xs text-danger hover:underline">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">Tags in use ({tags.length})</div>
        {tags.length === 0 ? (
          <p className="text-sm text-muted">
            No tags yet. In the Leads page, select leads and type a tag name in the bulk bar to create one —
            tags are created the moment you first use them.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Link key={tag} href={`/w/${slug}/leads?tag=${encodeURIComponent(tag)}`}>
                <Chip tone="secondary">
                  {tag} · {tagCounts[tag]}
                </Chip>
              </Link>
            ))}
          </div>
        )}
        <p className="text-xs text-muted mt-3">
          Tags are flexible labels — a lead can have many. Click a tag to see its leads. Campaigns can target a
          tag directly in the Audience tab.
        </p>
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">How this fits together</div>
        <div className="space-y-2 text-xs text-muted">
          <div>
            <span className="font-medium text-ink">1. Import leads</span> — Leads page → Import CSV (Apollo /
            Sales Navigator exports auto-map). Assign a list and/or tags during import.
          </div>
          <div>
            <span className="font-medium text-ink">2. Organise</span> — select leads → bulk bar → add tags or
            &quot;Add to list…&quot;. Create either right there or on this page.
          </div>
          <div>
            <span className="font-medium text-ink">3. Target</span> — Campaigns → Audience tab → choose a list,
            a tag, or 2-3 of your own test emails for a safe dry run.
          </div>
        </div>
      </Card>
    </div>
  );
}
