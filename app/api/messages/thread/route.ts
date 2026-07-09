import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Full thread for the inbox drawer: by campaign_lead or provider thread id.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const campaignLead = req.nextUrl.searchParams.get("campaign_lead");
  const thread = req.nextUrl.searchParams.get("thread");

  let q = supabase.from("messages").select("*").order("occurred_at", { ascending: true }).limit(50);
  if (campaignLead) q = q.eq("campaign_lead_id", campaignLead);
  else if (thread) q = q.eq("provider_thread_id", thread);
  else return NextResponse.json({ messages: [] });

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}
