"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Card } from "@/components/ui";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export default function NewWorkspacePage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const slug = slugify(name) || `ws-${Date.now()}`;
    const { data: ws, error: wsErr } = await supabase
      .from("workspaces")
      .insert({ name, slug })
      .select()
      .single();
    if (wsErr || !ws) {
      setBusy(false);
      setError(wsErr?.message ?? "Could not create workspace");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: memErr } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: ws.id, user_id: user!.id, role: "admin" });
    setBusy(false);
    if (memErr) {
      setError(memErr.message);
      return;
    }
    router.push(`/w/${slug}`);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-lg font-semibold tracking-tight">Create a workspace</div>
          <div className="text-sm text-muted mt-1">One workspace per client. Pilot: Socivo.</div>
        </div>
        <Card>
          <form onSubmit={create} className="space-y-4">
            <div>
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Socivo"
                required
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "…" : "Create workspace"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
