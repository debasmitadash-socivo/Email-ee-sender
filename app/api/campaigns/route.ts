import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { workspace_id, name } = await req.json();
  if (!workspace_id || !name) {
    return NextResponse.json({ error: "workspace_id and name required" }, { status: 400 });
  }
  if (!(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id,
      name,
      settings: {
        plain_text: true,
        track_opens: false,
        track_clicks: false,
        approve_first_n: 10,
        send_window: { start: "08:30", end: "17:30", days: [1, 2, 3, 4, 5] },
        timezone_mode: "fixed",
        fixed_tz: "Europe/London",
        linkedin_enrichment: false,
        daily_domain_cap: 5,
        allow_free_domains: false,
        us_targeting: false,
      },
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
