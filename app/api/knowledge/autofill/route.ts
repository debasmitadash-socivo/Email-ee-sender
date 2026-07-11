import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/api-guard";
import { runChain, ChainExhaustedError } from "@/lib/providers/run-chain";
import { aiModels } from "@/config/providers";
import type { KnowledgeProfile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function aiComplete(provider: string, apiKey: string, system: string, user: string): Promise<string> {
  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiModels.gemini}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  if (provider === "groq" || provider === "openrouter") {
    const url =
      provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://openrouter.ai/api/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModels[provider],
        temperature: 0.3,
        max_tokens: 1024,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${provider} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModels.anthropic,
        max_tokens: 1024,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }
  throw new Error(`unknown provider ${provider}`);
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Fill the Knowledge profile from a free-text company description (and
// optionally a fetched site page). No invented facts beyond what's given —
// same "ground in sources" discipline as the research pipeline.
export async function POST(req: NextRequest) {
  const { workspace_id, company_info, website } = await req.json();
  if (!workspace_id || (!company_info && !website)) {
    return NextResponse.json({ error: "workspace_id and company_info (or website) required" }, { status: 400 });
  }
  if (!(await requireMember(workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  let siteText = "";
  if (website) {
    try {
      const url = website.startsWith("http") ? website : `https://${website}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SocivoOnboard/1.0)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const html = await res.text();
        siteText = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 5000);
      }
    } catch {
      // site fetch is best-effort; company_info text still works alone
    }
  }

  if (!company_info && !siteText) {
    return NextResponse.json(
      { error: "Couldn't read that website and no company description was given — paste a short description instead." },
      { status: 422 }
    );
  }

  const system = `You fill in a B2B company's outreach profile from what the user gives you.
CRITICAL: only use facts present in the provided text. If something isn't stated, leave it as an empty
string or empty array — never invent details, numbers, or claims.
Respond with strict JSON only, this exact shape:
{"what_we_sell":"...","offer":"...","icp":"...","pains":["..."],"proof_points":["..."],"tone_rules":"...","sender_name":""}
- what_we_sell: one or two sentences, what the company does.
- offer: what a cold email from this company would propose.
- icp: who they sell to (industry, company size, role).
- pains: 2-4 problems their ICP has that this company solves.
- proof_points: only include real claims/numbers/names found in the text (e.g. "50+ clients", a
  named case study) — if none are present, return an empty array, do not fabricate.
- tone_rules: a short instruction for how outreach copy should sound, inferred from the text's own voice.
- sender_name: leave empty unless a specific person's name is given.
UK English.`;

  const user = JSON.stringify({ company_info: company_info ?? "", website_content: siteText }).slice(0, 12_000);

  try {
    const { result } = await runChain(admin, "ai_brief", async (provider, apiKey) => {
      const raw = await aiComplete(provider, apiKey, system, user);
      try {
        return parseJson<Partial<KnowledgeProfile>>(raw);
      } catch {
        const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only, nothing else.", raw);
        return parseJson<Partial<KnowledgeProfile>>(retry);
      }
    });
    return NextResponse.json({ ok: true, profile: result });
  } catch (err) {
    if (err instanceof ChainExhaustedError) {
      return NextResponse.json(
        { error: "No AI provider key configured yet. Add a free Gemini/Groq/OpenRouter key in your deployment's env vars to use autofill." },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
