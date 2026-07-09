import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  // RLS on lead_research scopes via the lead's workspace membership
  const { data } = await supabase
    .from("lead_research")
    .select("brief, sources, status, updated_at")
    .eq("lead_id", params.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ brief: null });
  return NextResponse.json(data);
}
