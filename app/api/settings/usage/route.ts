import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";
import { chains, type Capability } from "@/config/providers";

export const dynamic = "force-dynamic";

// Provider usage vs quota (provider_usage is service-role only, so this
// route bridges it to the settings UI after a membership check).
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  if (!workspaceId || !(await requireMember(workspaceId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = createAdminClient();
  const { data: usage } = await admin
    .from("provider_usage")
    .select("*")
    .eq("day", new Date().toISOString().slice(0, 10));

  const result = Object.entries(chains).map(([capability, entries]) => ({
    capability,
    providers: entries.map((e) => {
      const u = usage?.find((r) => r.provider === e.provider && r.capability === capability);
      return {
        provider: e.provider,
        configured: !!process.env[e.envKey],
        quota: e.dailyQuota,
        used: u?.used ?? 0,
        failed: u?.failed ?? 0,
      };
    }),
  }));
  return NextResponse.json({ capabilities: result as { capability: Capability | string; providers: unknown[] }[] });
}
