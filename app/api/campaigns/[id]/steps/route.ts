import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface StepInput {
  step_no: number;
  variant?: string;
  delay_days: number;
  subject?: string | null;
  body: string;
}

// Replace the campaign's sequence steps wholesale (builder saves the full set).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { steps } = (await req.json()) as { steps: StepInput[] };
  if (!Array.isArray(steps)) return NextResponse.json({ error: "steps required" }, { status: 400 });

  // RLS validates campaign visibility
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: delErr } = await supabase.from("sequence_steps").delete().eq("campaign_id", params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (steps.length) {
    const rows = steps.map((s) => ({
      campaign_id: params.id,
      step_no: s.step_no,
      variant: (s.variant ?? "A").slice(0, 1).toUpperCase(),
      delay_days: Math.max(0, s.delay_days),
      subject: s.subject || null,
      body: s.body ?? "",
    }));
    const { error } = await supabase.from("sequence_steps").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
