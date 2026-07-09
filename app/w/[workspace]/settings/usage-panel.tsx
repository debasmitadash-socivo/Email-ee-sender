"use client";
import { useEffect, useState } from "react";
import { Card, Chip } from "@/components/ui";

interface ProviderUsage {
  provider: string;
  configured: boolean;
  quota: number;
  used: number;
  failed: number;
}

export function UsagePanel({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<{ capability: string; providers: ProviderUsage[] }[] | null>(null);

  useEffect(() => {
    fetch(`/api/settings/usage?workspace=${workspaceId}`)
      .then((r) => r.json())
      .then((d) => setData(d.capabilities ?? []))
      .catch(() => setData([]));
  }, [workspaceId]);

  if (!data) return <p className="text-sm text-muted">Loading usage…</p>;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {data.map((cap) => (
        <Card key={cap.capability}>
          <h2 className="text-sm font-semibold mb-3">{cap.capability}</h2>
          <div className="space-y-3">
            {cap.providers.map((p) => (
              <div key={p.provider}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="flex items-center gap-2">
                    {p.provider}
                    {!p.configured && <Chip tone="muted">no key</Chip>}
                    {p.failed >= 3 && <Chip tone="danger">benched today</Chip>}
                  </span>
                  <span className="text-muted tabular-nums text-xs">
                    {p.used}/{p.quota} today{p.failed ? ` · ${p.failed} failed` : ""}
                  </span>
                </div>
                <div className="h-1.5 rounded-full border border-border overflow-hidden">
                  <div
                    className={`h-full ${p.used / p.quota > 0.85 ? "bg-warn" : "bg-secondary/60"}`}
                    style={{ width: `${Math.min(100, (p.used / p.quota) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
