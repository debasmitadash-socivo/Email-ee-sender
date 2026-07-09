"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Chip, Empty, Input, Select, Table, Th, Td } from "@/components/ui";

interface Entry {
  id: string;
  workspace_id: string | null;
  value: string;
  kind: "email" | "domain";
  reason: string | null;
  created_at: string;
}

export function SuppressionClient({ workspaceId, entries }: { workspaceId: string; entries: Entry[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"email" | "domain">("email");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("suppression").insert({
      workspace_id: workspaceId,
      value: value.trim().toLowerCase(),
      kind,
      reason: "manual",
    });
    if (error) setError(error.message);
    else {
      setValue("");
      router.refresh();
    }
  }

  async function remove(id: string) {
    await supabase.from("suppression").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="flex gap-2 items-start flex-wrap">
        <Input
          className="max-w-xs"
          placeholder={kind === "email" ? "person@company.com" : "company.com"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        <Select value={kind} onChange={(e) => setKind(e.target.value as "email" | "domain")}>
          <option value="email">Email</option>
          <option value="domain">Domain</option>
        </Select>
        <Button type="submit">Suppress</Button>
        {error && <p className="text-sm text-danger w-full">{error}</p>}
      </form>
      <p className="text-sm text-muted">
        Suppressed emails/domains are never sent to — checked again at send time, across every campaign.
        Global entries (from unsubscribes) apply to all workspaces.
      </p>
      {entries.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Value</Th>
              <Th>Kind</Th>
              <Th>Scope</Th>
              <Th>Reason</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((s) => (
              <tr key={s.id}>
                <Td>{s.value}</Td>
                <Td>
                  <Chip tone="muted">{s.kind}</Chip>
                </Td>
                <Td>{s.workspace_id ? "workspace" : "global"}</Td>
                <Td>{s.reason ?? "—"}</Td>
                <Td>
                  {s.workspace_id && (
                    <button className="text-danger text-xs hover:underline" onClick={() => remove(s.id)}>
                      Remove
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>No suppression entries.</Empty>
      )}
    </div>
  );
}
