"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Workspace } from "@/lib/types";

const NAV = [
  { seg: "", label: "Dashboard" },
  { seg: "mailboxes", label: "Mailboxes" },
  { seg: "contacts", label: "Contacts" },
  { seg: "leads", label: "Leads" },
  { seg: "campaigns", label: "Campaigns" },
  { seg: "approvals", label: "Approvals" },
  { seg: "inbox", label: "Inbox" },
  { seg: "templates", label: "Templates" },
  { seg: "knowledge", label: "Knowledge" },
  { seg: "settings", label: "Settings" },
];

export function Topbar({
  workspace,
  allWorkspaces,
}: {
  workspace: Workspace;
  allWorkspaces: Workspace[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/w/${workspace.slug}`;

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-6 flex items-center h-14 gap-6">
        <span className="font-bold tracking-tight text-[15px] whitespace-nowrap flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-white text-[11px] font-bold shadow-sm">
            S
          </span>
          Socivo
        </span>
        <select
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm max-w-[160px]"
          value={workspace.slug}
          onChange={(e) => {
            if (e.target.value === "__new__") router.push("/new-workspace");
            else router.push(`/w/${e.target.value}`);
          }}
        >
          {allWorkspaces.map((w) => (
            <option key={w.id} value={w.slug}>
              {w.name}
            </option>
          ))}
          <option value="__new__">+ New workspace…</option>
        </select>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map(({ seg, label }) => {
            const href = seg ? `${base}/${seg}` : base;
            const active = seg
              ? pathname.startsWith(href)
              : pathname === base;
            return (
              <Link
                key={seg}
                href={href}
                className={
                  "px-3 py-1.5 rounded-full text-sm whitespace-nowrap " +
                  (active ? "text-primary font-medium bg-primary/10" : "text-muted hover:text-ink hover:bg-border/40")
                }
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <button onClick={signOut} className="ml-auto text-sm text-muted hover:text-ink whitespace-nowrap">
          Sign out
        </button>
      </div>
    </header>
  );
}
