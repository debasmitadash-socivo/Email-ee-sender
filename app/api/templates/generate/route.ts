import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";
import { runChain, ChainExhaustedError } from "@/lib/providers/run-chain";
import { aiComplete, parseAiJson } from "@/lib/ai";
import type { KnowledgeProfile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Generate a template draft from the workspace knowledge profile.
// Returns it for the user to review/edit in the template editor — never saves directly.
export async function POST(req: NextRequest) {
  const { workspace_id, style } = (await req.json()) as { workspace_id: string; style?: string };
  if (!workspace_id || !(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: knowledge } = await admin.from("knowledge").select("profile").eq("workspace_id", workspace_id).maybeSingle();
  const profile = (knowledge?.profile ?? {}) as KnowledgeProfile;
  if (!profile.what_we_sell && !profile.offer) {
    return NextResponse.json(
      { error: "Fill in the Knowledge page first (what we sell + the offer) — the generator writes from it." },
      { status: 422 }
    );
  }

  const styles: Record<string, string> = {
    direct: "Short and direct: 3-4 sentences, one clear ask.",
    value: "Value-first: lead with the pain and the outcome, soft ask.",
    question: "Question-led: open with a sharp question about their situation.",
  };
  const chosen = styles[style ?? "direct"] ?? styles.direct;

  const system = `You write cold-email TEMPLATES for a B2B agency. Rules:
- UK English, plain and human, no exclamation marks, no clichés, no spam words (act now, guarantee, free trial...).
- Use merge tags where personal data goes: {{first_name}}, {{company}}, {{title}}.
- Include exactly one AI slot {{ai_icebreaker}} as the opening personalised line (the research engine fills it per-lead).
- Body under 90 words. Subject under 7 words, lowercase feel, no clickbait.
- ${chosen}
Respond with strict JSON only: {"name":"...","subject":"...","body":"..."}`;

  const user = JSON.stringify({
    what_we_sell: profile.what_we_sell,
    offer: profile.offer,
    icp: profile.icp,
    pains: profile.pains,
    proof_points: profile.proof_points,
    tone_rules: profile.tone_rules,
    sender_name: profile.sender_name,
  }).slice(0, 8000);

  try {
    const { result } = await runChain(admin, "ai_write", async (provider, apiKey) => {
      const raw = await aiComplete(provider, apiKey, system, user);
      try {
        return parseAiJson<{ name: string; subject: string; body: string }>(raw);
      } catch {
        const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only, nothing else.", raw);
        return parseAiJson<{ name: string; subject: string; body: string }>(retry);
      }
    });
    return NextResponse.json({ ok: true, template: result });
  } catch (err) {
    if (err instanceof ChainExhaustedError) {
      return NextResponse.json(
        { error: "No AI key available — add one in Settings → API Keys." },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
