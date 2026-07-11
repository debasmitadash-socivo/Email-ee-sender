"use client";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input } from "@/components/ui";
import type { AddableProvider } from "@/config/providers";

interface KeyRow {
  id: string;
  provider: string;
  label: string | null;
  active: boolean;
  exhausted_date: string | null;
  created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function KeysClient({ workspaceId, providers }: { workspaceId: string; providers: AddableProvider[] }) {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/api/provider-keys?workspace=${workspaceId}`);
    const data = await res.json();
    setKeys(data.keys ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <ProviderRow
          key={p.provider}
          meta={p}
          keys={keys.filter((k) => k.provider === p.provider)}
          workspaceId={workspaceId}
          onChange={load}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  meta,
  keys,
  workspaceId,
  onChange,
}: {
  meta: AddableProvider;
  keys: KeyRow[];
  workspaceId: string;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/provider-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, provider: meta.provider, key: value, label }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error);
    setValue("");
    setLabel("");
    setAdding(false);
    onChange();
  }

  async function remove(id: string) {
    await fetch(`/api/provider-keys/${id}?workspace=${workspaceId}`, { method: "DELETE" });
    onChange();
  }
  async function reset(id: string) {
    await fetch(`/api/provider-keys/${id}?workspace=${workspaceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset_exhausted: true }),
    });
    onChange();
  }

  const activeCount = keys.filter((k) => k.active && k.exhausted_date !== today()).length;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{meta.name}</span>
            {keys.length > 0 &&
              (activeCount > 0 ? (
                <Chip tone="success">
                  {activeCount} active key{activeCount > 1 ? "s" : ""}
                </Chip>
              ) : (
                <Chip tone="warn">all keys used up today</Chip>
              ))}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {meta.powers} · <span className="text-secondary">{meta.free}</span> ·{" "}
            <a href={meta.signupUrl} target="_blank" rel="noreferrer" className="hover:underline">
              get a free key ↗
            </a>
          </div>
        </div>
        {!adding && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            + Add key
          </Button>
        )}
      </div>

      {keys.length > 0 && (
        <ul className="mt-3 space-y-1">
          {keys.map((k) => {
            const exhausted = k.exhausted_date === today();
            return (
              <li key={k.id} className="flex items-center justify-between text-xs border border-border rounded-md px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="text-muted">🔑 {k.label || "key"}</span>
                  {exhausted && <Chip tone="warn">used up · resets tomorrow</Chip>}
                  {!k.active && <Chip tone="muted">disabled</Chip>}
                </span>
                <span className="flex items-center gap-3">
                  {exhausted && (
                    <button className="text-secondary hover:underline" onClick={() => reset(k.id)}>
                      reset
                    </button>
                  )}
                  <button className="text-danger hover:underline" onClick={() => remove(k.id)}>
                    remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <div className="mt-3 flex gap-2 flex-wrap items-start">
          <Input
            className="flex-1 min-w-[220px]"
            placeholder={`Paste your ${meta.name} API key`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="password"
          />
          <Input
            className="max-w-[160px]"
            placeholder="label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button onClick={add} disabled={busy || value.trim().length < 8}>
            {busy ? "…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          {err && <p className="text-xs text-danger w-full">{err}</p>}
        </div>
      )}
    </Card>
  );
}
