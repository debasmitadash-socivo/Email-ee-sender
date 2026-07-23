"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Input, Select } from "@/components/ui";

export interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: "admin" | "l3_full" | "l2_limited" | "l1_basic";
  users: { email: string; name: string | null } | null;
}

export interface InviteRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

const ROLES: { value: string; label: string; description: string }[] = [
  { value: "l1_basic", label: "L1 · Basic", description: "Read-only: leads, inbox, analytics" },
  { value: "l2_limited", label: "L2 · Limited", description: "Create/edit leads & campaigns, approve drafts — no settings, no deletes" },
  { value: "l3_full", label: "L3 · Full", description: "Everything incl. mailboxes & deletes — no member management" },
  { value: "admin", label: "Admin", description: "Full access incl. inviting/removing people" },
];

const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

export function WorkspaceMembers({
  workspaceId,
  members,
  invites,
  currentUserId,
  currentUserRole,
}: {
  workspaceId: string;
  members: MemberRow[];
  invites: InviteRow[];
  currentUserId: string;
  currentUserRole: string;
}) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("l2_limited");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = currentUserRole === "admin";
  const adminCount = members.filter((m) => m.role === "admin").length;

  async function invite() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setMsg(data.added ? "Added — they already have an account, so access is live now." : "Invited — access activates the moment they sign up with this email.");
      setInviteEmail("");
      router.refresh();
    } else {
      setMsg(`Error: ${data.error}`);
    }
  }

  async function changeRole(userId: string, role: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) router.refresh();
    else setMsg(`Error: ${(await res.json()).error}`);
  }

  async function removeMember(userId: string, email: string) {
    if (!confirm(`Remove ${email} from this workspace?`)) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setMsg(`Error: ${(await res.json()).error}`);
  }

  async function cancelInvite(inviteId: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}/members?invite=${inviteId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card>
          <div className="text-sm font-medium mb-3">Invite a teammate</div>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-64">
              <label className="text-xs text-muted block mb-1">Email</label>
              <Input
                placeholder="teammate@yourcompany.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="min-w-48">
              <label className="text-xs text-muted block mb-1">Access level</label>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={invite} disabled={busy || !inviteEmail.includes("@")}>
              {busy ? "…" : "Invite"}
            </Button>
          </div>
          {msg && <p className="text-xs text-muted mt-2">{msg}</p>}
          <p className="text-xs text-muted mt-2">
            If they already have an account, access is instant. If not, it activates automatically when they
            sign up with this email.
          </p>
        </Card>
      )}

      <Card>
        <div className="text-sm font-medium mb-4">Members ({members.length})</div>
        <div className="space-y-2">
          {members.map((m) => {
            const email = m.users?.email ?? m.user_id;
            const isSelf = m.user_id === currentUserId;
            const lastAdmin = m.role === "admin" && adminCount <= 1;
            return (
              <div
                key={m.user_id}
                className="flex items-center justify-between gap-3 p-3 border border-border rounded-md flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {m.users?.name || email}
                    {isSelf && <span className="text-muted font-normal"> (you)</span>}
                  </div>
                  <div className="text-xs text-muted">{email}</div>
                </div>
                {isAdmin && !lastAdmin ? (
                  <div className="flex items-center gap-2">
                    <Select value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value)}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                    {!isSelf && (
                      <button
                        onClick={() => removeMember(m.user_id, email)}
                        className="text-xs text-danger hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <Chip tone={m.role === "admin" ? "primary" : "secondary"}>{roleLabel(m.role)}</Chip>
                )}
              </div>
            );
          })}
        </div>

        {invites.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Pending invites</div>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {inv.email} <span className="text-muted text-xs">· {roleLabel(inv.role)} · waiting for signup</span>
                  </span>
                  {isAdmin && (
                    <button onClick={() => cancelInvite(inv.id)} className="text-xs text-danger hover:underline">
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">What each level can do</div>
        <div className="space-y-2 text-xs">
          {ROLES.map((r) => (
            <div key={r.value}>
              <span className="font-medium">{r.label}</span>
              <span className="text-muted"> — {r.description}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
