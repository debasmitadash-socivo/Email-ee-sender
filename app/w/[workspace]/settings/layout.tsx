import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";

const TABS = [
  { seg: "", label: "Providers & Quotas" },
  { seg: "keys", label: "API Keys" },
  { seg: "suppression", label: "Suppression" },
  { seg: "notifications", label: "Notifications" },
  { seg: "webhooks", label: "Webhooks" },
  { seg: "team", label: "Team" },
  { seg: "deliverability", label: "Deliverability" },
];

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { workspace: string };
}) {
  const { workspace } = await requireWorkspace(params.workspace);
  const base = `/w/${workspace.slug}/settings`;
  return (
    <div className="grid md:grid-cols-[200px_1fr] gap-8">
      <nav className="space-y-1">
        {TABS.map((t) => (
          <Link
            key={t.seg}
            href={t.seg ? `${base}/${t.seg}` : base}
            className="block px-3 py-1.5 rounded-md text-sm text-muted hover:text-ink"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
