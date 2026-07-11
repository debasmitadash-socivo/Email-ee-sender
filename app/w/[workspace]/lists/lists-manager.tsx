"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Chip } from "@/components/ui";

interface List {
  id: string;
  name: string;
  created_at: string;
}

export function ListsManager({
  workspaceId,
  lists,
  allTags,
  totalLeads,
}: {
  workspaceId: string;
  lists: List[];
  allTags: string[];
  totalLeads: number;
}) {
  const router = useRouter();
  const [newListName, setNewListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
    if (!confirm("Delete this list? Leads will keep their data but list assignment is removed.")) return;
    const res = await fetch(`/api/leads/lists/${listId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="text-sm font-medium mb-3">Create new list</div>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Q4 2024 Outreach, SMB Tech Leads"
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
          Lists are sequential containers for leads. Use one per campaign or per cohort. When building a campaign
          audience, select a list to lock in the leads for that campaign.
        </p>
      </Card>

      <Card>
        <div className="text-sm font-medium mb-4">
          Lists ({lists.length}) · Total leads: {totalLeads}
        </div>
        {lists.length === 0 ? (
          <p className="text-sm text-muted">No lists yet. Create one above to organize leads.</p>
        ) : (
          <div className="space-y-2">
            {lists.map((list) => (
              <div key={list.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{list.name}</div>
                  <div className="text-xs text-muted">
                    Created {new Date(list.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => deleteList(list.id)}
                  className="text-xs text-danger hover:underline"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {allTags.length > 0 && (
        <Card>
          <div className="text-sm font-medium mb-3">Tags in use ({allTags.length})</div>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => (
              <Chip key={tag} tone="secondary">
                {tag}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-muted mt-3">
            Tags are flexible labels applied to leads. In the Leads page, click any tag to filter, or bulk-tag multiple
            leads at once. Use tags to build dynamic campaign audiences alongside lists.
          </p>
        </Card>
      )}

      <Card>
        <div className="text-sm font-medium mb-3">How to use</div>
        <div className="space-y-2 text-xs text-muted">
          <div>
            <span className="font-medium text-foreground">Create a list</span> when you want a fixed set of leads
            (e.g., "Q4 Targets"). Go to the Leads page, select all leads for that list, then bulk-assign them here.
          </div>
          <div>
            <span className="font-medium text-foreground">Use tags</span> for flexible grouping. In Leads, bulk-tag
            leads (e.g., "follow-up", "hot"). Then in Campaigns, filter by tag to build dynamic audiences.
          </div>
          <div>
            <span className="font-medium text-foreground">Build a campaign</span>: Go to Campaigns → Create →
            Audience. Choose "List" (fixed) or "Tag" (dynamic) or "Test emails" (your own inboxes).
          </div>
        </div>
      </Card>
    </div>
  );
}
