"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Chip, Input, Select } from "@/components/ui";

interface Member {
  id: string;
  user_id: string;
  role: "admin" | "l3_full" | "l2_limited" | "l1_basic";
  invited_at: string;
  accepted_at: string | null;
  users: { email: string };
}

const ROLE_LABELS: Record<string, { label: string; description: string; tone?: "secondary" | "primary" | "warn" }> = {
  admin: { label: "Admin", description: "Full workspace access", tone: "primary" },
  l3_full: { label: "L3 Full", description: "All features, all campaigns", tone: "primary" },
  l2_limited: { label: "L2 Limited", description: "View & edit leads/campaigns, no settings", tone: "secondary" },
  l1_basic: { label: "L1 Basic", description: "View-only: leads, inbox, analytics", tone: "secondary" },
};

export function WorkspaceMembers({
  workspaceId,
  members,
  currentUserRole,
}: {
  workspaceId: string;
  members: Member[];
  currentUserRole: string;
}) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("l2_limited");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = currentUserRole === "admin";

  async function inviteMember() {
    if (!inviteEmail) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Invitation sent.");
      setInviteEmail("");
      router.refresh();
    } else {
      const data = await res.json();
      setMsg(`Error: ${data.error}`);
    }
  }

  async function updateRole(memberId: string, newRole: string) {
    if (!isAdmin) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) router.refresh();
  }

  async function removeMember(memberId: string) {
    if (!isAdmin) return;
    if (!confirm("Remove this member from the workspace?")) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
      method: "DELETE",
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card>
          <div className="text-sm font-medium mb-3">Invite team member</div>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-64">
              <label className="text-xs text-muted block mb-1">Email</label>
              <Input
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="min-w-40">
              <label className="text-xs text-muted block mb-1">Role</label>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="l1_basic">L1 Basic</option>
                <option value="l2_limited">L2 Limited</option>
                <option value="l3_full">L3 Full</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <Button onClick={inviteMember} disabled={busy || !inviteEmail}>
              {busy ? "…" : "Invite"}
            </Button>
          </div>
          {msg && <p className="text-xs text-muted mt-2">{msg}</p>}
        </Card>
      )}

      <Card>
        <div className="text-sm font-medium mb-4">Members ({members.length})</div>
        <div className="space-y-3">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{m.users.email}</div>
                <div className="text-xs text-muted">{ROLE_LABELS[m.role].description}</div>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={ROLE_LABELS[m.role].tone as any}>{ROLE_LABELS[m.role].label}</Chip>
                {!m.accepted_at && <span className="text-xs text-warn">pending invite</span>}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  {m.accepted_at && (
                    <>
                      <Select
                        value={m.role}
                        onChange={(e) => updateRole(m.id, e.target.value)}
                        className="text-xs"
                      >
                        <option value="l1_basic">L1</option>
                        <option value="l2_limited">L2</option>
                        <option value="l3_full">L3</option>
                        <option value="admin">Admin</option>
                      </Select>
                      <button
                        onClick={() => removeMember(m.id)}
                        className="text-xs text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">Role permissions</div>
        <div className="space-y-2 text-xs">
          <div>
            <span className="font-medium">L1 Basic</span>: Read-only access to leads, inbox, analytics
          </div>
          <div>
            <span className="font-medium">L2 Limited</span>: Create/edit leads and campaigns, approve drafts, no workspace settings
          </div>
          <div>
            <span className="font-medium">L3 Full</span>: All features including mailbox management, no member access control
          </div>
          <div>
            <span className="font-medium">Admin</span>: Full access including invite/remove members and workspace settings
          </div>
        </div>
      </Card>
    </div>
  );
}
