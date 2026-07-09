import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Chip, stateTone, Empty, Table, Th, Td } from "@/components/ui";
import { NewCampaignButton } from "./new-campaign";
import Link from "next/link";

export default async function CampaignsPage({ params }: { params: { workspace: string } }) {
  const { workspace } = await requireWorkspace(params.workspace);
  const supabase = createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*, campaign_leads(count)")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="Campaigns" action={<NewCampaignButton workspaceId={workspace.id} slug={workspace.slug} />} />
      {campaigns?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Leads</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/w/${workspace.slug}/campaigns/${c.id}`} className="hover:underline font-medium">
                    {c.name}
                  </Link>
                </Td>
                <Td>
                  <Chip tone={stateTone(c.status)}>{c.status}</Chip>
                </Td>
                <Td>{(c.campaign_leads as { count: number }[] | null)?.[0]?.count ?? 0}</Td>
                <Td>{new Date(c.created_at).toLocaleDateString("en-GB")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>No campaigns yet. Create one to start the sequence builder.</Empty>
      )}
    </div>
  );
}
