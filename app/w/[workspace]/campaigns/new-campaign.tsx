"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";

export function NewCampaignButton({ workspaceId, slug }: { workspaceId: string; slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, name }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) router.push(`/w/${slug}/campaigns/${data.id}`);
  }

  if (!open) return <Button onClick={() => setOpen(true)}>New campaign</Button>;
  return (
    <form onSubmit={create} className="flex gap-2">
      <Input autoFocus placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Button type="submit" disabled={busy}>
        {busy ? "…" : "Create"}
      </Button>
    </form>
  );
}
