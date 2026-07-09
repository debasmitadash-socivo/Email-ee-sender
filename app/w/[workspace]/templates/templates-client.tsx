"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Chip, Empty, Input, Label, Textarea } from "@/components/ui";

interface Template {
  id: string;
  workspace_id: string | null;
  name: string;
  subject: string;
  body: string;
  ai_slots: Record<string, { instruction: string; max_words?: number }>;
}

export function TemplatesClient({ workspaceId, templates }: { workspaceId: string; templates: Template[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  return (
    <div>
      <div className="mb-6">
        <Button onClick={() => setEditing("new")}>New template</Button>
      </div>
      {editing && (
        <TemplateEditor
          workspaceId={workspaceId}
          template={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {templates.length ? (
        <div className="grid md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <Card key={t.id}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{t.name}</span>
                <div className="flex items-center gap-2">
                  {!t.workspace_id && <Chip tone="secondary">global</Chip>}
                  {Object.keys(t.ai_slots ?? {}).length > 0 && (
                    <Chip tone="primary">{Object.keys(t.ai_slots).length} AI slots</Chip>
                  )}
                  {t.workspace_id && (
                    <button className="text-xs text-secondary hover:underline" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted mb-1">Subject: {t.subject}</div>
              <pre className="text-xs whitespace-pre-wrap text-muted max-h-40 overflow-y-auto">{t.body}</pre>
            </Card>
          ))}
        </div>
      ) : (
        <Empty>No templates yet.</Empty>
      )}
    </div>
  );
}

function TemplateEditor({
  workspaceId,
  template,
  onClose,
}: {
  workspaceId: string;
  template: Template | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [slotsJson, setSlotsJson] = useState(JSON.stringify(template?.ai_slots ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let ai_slots: Record<string, unknown>;
    try {
      ai_slots = JSON.parse(slotsJson || "{}");
    } catch {
      setError("AI slots must be valid JSON");
      return;
    }
    setBusy(true);
    const row = { workspace_id: workspaceId, name, subject, body, ai_slots };
    const { error } = template
      ? await supabase.from("templates").update(row).eq("id", template.id)
      : await supabase.from("templates").insert(row);
    setBusy(false);
    if (error) setError(error.message);
    else onClose();
  }

  async function remove() {
    if (!template) return;
    await supabase.from("templates").delete().eq("id", template.id);
    onClose();
  }

  return (
    <Card className="mb-6">
      <div className="space-y-3 max-w-2xl">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>Body</Label>
          <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div>
          <Label>AI slots (JSON)</Label>
          <Textarea
            rows={5}
            value={slotsJson}
            onChange={(e) => setSlotsJson(e.target.value)}
            placeholder={'{ "ai_icebreaker": { "instruction": "One specific, sourced opening line.", "max_words": 30 } }'}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy || !name}>
            {busy ? "…" : "Save template"}
          </Button>
          {template && (
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
