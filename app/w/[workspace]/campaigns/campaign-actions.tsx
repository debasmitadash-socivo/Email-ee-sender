"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function CampaignActions({
  campaignId,
  campaignStatus,
  slug,
}: {
  campaignId: string;
  campaignStatus: string;
  slug: string;
}) {
  const router = useRouter();

  async function pauseResume() {
    const newStatus = campaignStatus === "running" ? "paused" : "running";
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) router.refresh();
  }

  async function deleteCampaign() {
    if (!confirm("Delete this campaign? All data will be lost.")) return;
    const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex gap-1 text-xs">
      {campaignStatus === "draft" && (
        <button className="text-secondary hover:underline">Configure</button>
      )}
      {campaignStatus === "running" && (
        <button onClick={pauseResume} className="text-secondary hover:underline">
          Pause
        </button>
      )}
      {campaignStatus === "paused" && (
        <button onClick={pauseResume} className="text-secondary hover:underline">
          Resume
        </button>
      )}
      <button onClick={deleteCampaign} className="text-danger hover:underline">
        Delete
      </button>
    </div>
  );
}
