"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Chip, Input, Label } from "@/components/ui";

const EVENTS = ["reply", "positive_reply", "bounce", "unsubscribe", "sequence_finished"];

interface Hook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
}

export function WebhooksClient({
  workspaceId,
  hooks,
  apiToken,
  portalUrl,
}: {
  workspaceId: string;
  hooks: Hook[];
  apiToken: string;
  portalUrl?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const secret = crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase.from("webhooks").insert({ workspace_id: workspaceId, url, events, secret });
    if (error) setError(error.message);
    else {
      setUrl("");
      router.refresh();
    }
  }

  async function remove(id: string) {
    await supabase.from("webhooks").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <h2 className="text-sm font-semibold mb-2">REST API</h2>
        <p className="text-sm text-muted mb-3">
          Authenticate with <code>Authorization: Bearer &lt;token&gt;</code>. Endpoints:{" "}
          <code>GET /api/v1/campaigns</code>, <code>POST /api/v1/leads</code>,{" "}
          <code>GET /api/v1/messages</code>.
        </p>
        <Label>Workspace API token</Label>
        <Input readOnly value={apiToken} onFocus={(e) => e.currentTarget.select()} />
      </Card>

      {portalUrl && (
        <Card>
          <h2 className="text-sm font-semibold mb-2">Client report link (white-label)</h2>
          <p className="text-sm text-muted mb-3">
            A read-only performance page for this workspace — no login, no app navigation, nothing but
            their numbers. Share it with the client; anyone with the link can view it.
          </p>
          <Input readOnly value={portalUrl} onFocus={(e) => e.currentTarget.select()} />
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold mb-3">Webhooks</h2>
        <p className="text-sm text-muted mb-4">
          Signed JSON POSTs (header <code>X-Socivo-Signature</code>, HMAC-SHA256 of the body with your
          secret) for: {EVENTS.join(", ")}.
        </p>
        <form onSubmit={add} className="space-y-3 mb-4">
          <Input
            type="url"
            placeholder="https://your-endpoint.example/hook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <div className="flex gap-3 flex-wrap">
            {EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))
                  }
                  className="accent-[#B56FDC]"
                />
                {ev}
              </label>
            ))}
          </div>
          <Button type="submit">Add webhook</Button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
        {hooks.map((h) => (
          <div key={h.id} className="border border-border rounded-md p-3 mb-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium truncate">{h.url}</span>
              <button className="text-danger text-xs hover:underline" onClick={() => remove(h.id)}>
                Remove
              </button>
            </div>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {h.events.map((e) => (
                <Chip key={e} tone="secondary">
                  {e}
                </Chip>
              ))}
            </div>
            <div className="text-xs text-muted mt-2">
              Secret: <code>{h.secret}</code>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
