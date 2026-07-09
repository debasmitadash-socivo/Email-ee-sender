"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Chip, Input, Select } from "@/components/ui";

interface Member {
  user_id: string;
  role: string;
  users: { name: string | null; email: string };
}
interface Invite {
  id: string;
  email: string;
  role: string;
}

export function TeamClient({
  workspaceId,
  isAdmin,
  members,
  invites,
}: {
  workspaceId: string;
  isAdmin: boolean;
  members: Member[];
  invites: Invite[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase
      .from("workspace_invites")
      .insert({ workspace_id: workspaceId, email: email.toLowerCase(), role });
    if (error) setError(error.message);
    else {
      setEmail("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {isAdmin && (
        <Card>
          <h2 className="text-sm font-semibold mb-3">Invite a teammate</h2>
          <form onSubmit={invite} className="flex gap-2">
            <Input
              type="email"
              placeholder="teammate@socivo.co.uk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </Select>
            <Button type="submit">Invite</Button>
          </form>
          <p className="text-xs text-muted mt-2">
            The invite is claimed automatically when they sign up with this email.
          </p>
          {error && <p className="text-sm text-danger mt-2">{error}</p>}
        </Card>
      )}
      <Card>
        <h2 className="text-sm font-semibold mb-3">Members</h2>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.user_id} className="py-2 flex items-center justify-between text-sm">
              <span>
                {m.users?.name ?? m.users?.email}
                <span className="text-muted text-xs ml-2">{m.users?.email}</span>
              </span>
              <Chip tone={m.role === "admin" ? "primary" : "muted"}>{m.role}</Chip>
            </li>
          ))}
        </ul>
        {invites.length > 0 && (
          <>
            <h3 className="text-xs font-medium text-muted mt-4 mb-2">Pending invites</h3>
            <ul className="divide-y divide-border">
              {invites.map((i) => (
                <li key={i.id} className="py-2 flex items-center justify-between text-sm">
                  <span>{i.email}</span>
                  <Chip tone="warn">{i.role} · pending</Chip>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
