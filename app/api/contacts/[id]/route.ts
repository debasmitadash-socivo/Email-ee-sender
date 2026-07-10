import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeNextSendAt, DEFAULT_WINDOW } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// Manual controls on a contact's sequence (id = campaign_lead id).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { action } = (await req.json()) as { action: "stop" | "resume" };

  // RLS scopes this through campaign membership
  const { data: cl } = await supabase.from("campaign_leads").select("*").eq("id", params.id).maybeSingle();
  if (!cl) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "stop") {
    const { error } = await supabase
      .from("campaign_leads")
      .update({ state: "paused", next_send_at: null, stop_reason: "manually stopped" })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, state: "paused" });
  }

  if (action === "resume") {
    if (!["paused", "failed"].includes(cl.state)) {
      return NextResponse.json({ error: `cannot resume from state ${cl.state}` }, { status: 422 });
    }
    const next = computeNextSendAt({
      base: new Date(),
      delayDays: 0,
      window: DEFAULT_WINDOW,
      timeZone: "Europe/London",
    });
    const { error } = await supabase
      .from("campaign_leads")
      .update({
        state: cl.current_step === 0 ? "scheduled" : "in_sequence",
        next_send_at: next.toISOString(),
        stop_reason: null,
      })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, state: "resumed" });
  }

  return NextResponse.json({ error: "action must be stop|resume" }, { status: 400 });
}
