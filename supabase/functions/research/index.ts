// Research/draft processor (build brief §9). Invoked by the tick with a small
// batch; runs the pipeline ONE STAGE per lead per invocation and returns —
// multi-tick by design so no invocation approaches the edge time limit.
//
// Stages per campaign_lead:
//   queued      → gather research (site scrape + optional LinkedIn + news) → researching
//   researching → build sourced brief (ai_brief) → write draft for the next
//                 step (ai_write) → QA gates → awaiting_approval | approved
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serviceClient, queueNotification, onceToday } from "../_shared/db.ts";
import { runChain, aiComplete, parseJson, ChainExhaustedError } from "../_shared/providers.ts";
import { spamWords, bannedPhrases } from "../_shared/config.ts";
import { computeNextSendAt } from "../_shared/schedule.ts";
import { spin, leadVars, renderVars } from "../_shared/render.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const CACHE_TTL_DAYS = 30;

const CRON_AUTH = Deno.env.get("CRON_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___never___";

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(CRON_AUTH)) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = serviceClient();
  const { batch = 5 } = await req.json().catch(() => ({}));

  const { data: cls } = await db
    .from("campaign_leads")
    .select("*, campaigns!inner(id, workspace_id, name, status, settings), leads!inner(*)")
    .in("state", ["queued", "researching"])
    .eq("campaigns.status", "running")
    .order("created_at")
    .limit(batch);

  const results: Record<string, string> = {};
  for (const cl of cls ?? []) {
    try {
      results[cl.id] = await processOne(db, cl);
    } catch (err) {
      console.error(`research failed for ${cl.id}:`, err);
      if (err instanceof ChainExhaustedError) {
        if (await onceToday(db, `chain:${err.capability}`)) {
          await queueNotification(db, cl.campaigns.workspace_id, "provider_quota_exhausted", {
            capability: err.capability,
          });
        }
        results[cl.id] = `chain exhausted: ${err.capability} — retrying next tick`;
      } else {
        results[cl.id] = `error: ${String(err).slice(0, 200)}`;
      }
    }
  }
  return Response.json(results);
});

async function processOne(db: SupabaseClient, cl: Row): Promise<string> {
  const lead = cl.leads;
  const campaign = cl.campaigns;

  if (cl.state === "queued") {
    await gatherResearch(db, cl, lead, campaign);
    await db.from("campaign_leads").update({ state: "researching" }).eq("id", cl.id);
    return "researched";
  }

  // researching → brief (if missing) + draft + QA
  const { data: research } = await db.from("lead_research").select("*").eq("lead_id", lead.id).maybeSingle();
  let brief = research?.brief;
  if (!brief) {
    brief = await buildBrief(db, lead, campaign, research?.sources ?? {});
    await db
      .from("lead_research")
      .upsert({ lead_id: lead.id, brief, sources: research?.sources ?? {}, status: "done", updated_at: new Date().toISOString() });
    return "brief_built"; // draft on the next invocation (one stage per tick)
  }

  return await writeDraft(db, cl, lead, campaign, brief, research?.sources ?? {});
}

// ── research gathering ───────────────────────────────────────────────────────
async function gatherResearch(db: SupabaseClient, cl: Row, lead: Row, campaign: Row) {
  const sources: Row = {};
  const domain = lead.domain ?? lead.email.split("@")[1];

  // site content, cached 30 days per domain
  const { data: cached } = await db.from("domain_research_cache").select("*").eq("domain", domain).maybeSingle();
  const fresh = cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_DAYS * 86_400_000;
  if (fresh) {
    sources.site = cached.content;
  } else {
    const site = await scrapeSite(db, domain);
    if (site) {
      sources.site = site;
      await db.from("domain_research_cache").upsert({ domain, content: site, fetched_at: new Date().toISOString() });
    }
  }

  // optional LinkedIn (per-campaign toggle, token present, under quota — else silent skip §7)
  const settings = campaign.settings ?? {};
  if (settings.linkedin_enrichment && lead.linkedin_url && Deno.env.get("APIFY_TOKEN")) {
    try {
      const { result } = await runChain(db, "linkedin", async (_provider, apiKey) => {
        const res = await fetch(
          `https://api.apify.com/v2/acts/apify~linkedin-profile-scraper/run-sync-get-dataset-items?token=${apiKey}&timeout=60`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profileUrls: [lead.linkedin_url] }),
          }
        );
        if (!res.ok) throw new Error(`apify ${res.status}`);
        const items = await res.json();
        return items?.[0] ?? null;
      });
      if (result) sources.linkedin = result;
    } catch {
      // skip silently; brief proceeds without it
    }
  }

  // news snippets via the search chain (best-effort)
  try {
    const query = lead.company ? `"${lead.company}" news` : `${domain} news`;
    const { result } = await runChain(db, "search", async (provider, apiKey) => {
      if (provider === "serper") {
        const res = await fetch("https://google.serper.dev/news", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 5 }),
        });
        if (!res.ok) throw new Error(`serper ${res.status}`);
        const data = await res.json();
        // deno-lint-ignore no-explicit-any
        return (data.news ?? []).slice(0, 5).map((n: any) => ({ title: n.title, snippet: n.snippet, url: n.link, date: n.date }));
      }
      if (provider === "tavily") {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, query, max_results: 5, topic: "news" }),
        });
        if (!res.ok) throw new Error(`tavily ${res.status}`);
        const data = await res.json();
        // deno-lint-ignore no-explicit-any
        return (data.results ?? []).slice(0, 5).map((r: any) => ({ title: r.title, snippet: r.content?.slice(0, 300), url: r.url }));
      }
      throw new Error(`unknown search provider ${provider}`);
    });
    if (result?.length) sources.news = result;
  } catch {
    // no news is fine
  }

  await db.from("lead_research").upsert({
    lead_id: lead.id,
    sources,
    status: "running",
    updated_at: new Date().toISOString(),
  });
}

async function scrapeSite(db: SupabaseClient, domain: string): Promise<Row | null> {
  const pages: Row = {};
  // layer 0: self-hosted plain fetch, free, always first (§7)
  for (const path of ["", "/about"]) {
    try {
      const res = await fetch(`https://${domain}${path}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SocivoResearch/1.0)" },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);
        if (text.length > 200) pages[path || "/"] = { url: `https://${domain}${path}`, text };
      }
    } catch {
      // fall through to the scrape chain
    }
  }
  if (Object.keys(pages).length) return pages;

  // scrape chain fallback (JS-heavy sites)
  try {
    const { result } = await runChain(db, "scrape", async (provider, apiKey) => {
      if (provider === "jina") {
        const res = await fetch(`https://r.jina.ai/https://${domain}`, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`jina ${res.status}`);
        return { "/": { url: `https://${domain}`, text: (await res.text()).slice(0, 6000) } };
      }
      if (provider === "firecrawl") {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://${domain}`, formats: ["markdown"] }),
        });
        if (!res.ok) throw new Error(`firecrawl ${res.status}`);
        const data = await res.json();
        return { "/": { url: `https://${domain}`, text: (data.data?.markdown ?? "").slice(0, 6000) } };
      }
      throw new Error(`unknown scrape provider ${provider}`);
    });
    return result;
  } catch {
    return null;
  }
}

// ── brief builder (§9.1) ─────────────────────────────────────────────────────
async function buildBrief(db: SupabaseClient, lead: Row, campaign: Row, sources: Row): Promise<Row> {
  const { data: knowledge } = await db
    .from("knowledge")
    .select("profile")
    .eq("workspace_id", campaign.workspace_id)
    .maybeSingle();
  const profile = knowledge?.profile ?? {};

  const system = `You are a B2B research analyst. Build a short brief for a personalised cold email.
CRITICAL RULE: only state facts present in the provided sources; if sources are thin, return fewer facts, never invent.
Respond with strict JSON only:
{"person":"...","company_summary":"...","recent_specifics":[{"fact":"...","source_url":"..."}],"likely_pain":"...","angle":"..."}
Each recent_specifics.source_url MUST be a URL that appears in the sources. UK English.`;

  const user = JSON.stringify({
    lead: {
      name: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
      title: lead.title,
      company: lead.company,
      domain: lead.domain,
    },
    our_profile: {
      what_we_sell: profile.what_we_sell,
      offer: profile.offer,
      icp: profile.icp,
      pains: profile.pains,
    },
    sources,
  }).slice(0, 24_000);

  const { result } = await runChain(db, "ai_brief", async (provider, apiKey) => {
    const raw = await aiComplete(provider, apiKey, system, user);
    try {
      return parseJson<Row>(raw);
    } catch {
      const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only, nothing else.", raw);
      return parseJson<Row>(retry);
    }
  });

  // hard filter: drop any "fact" whose source_url isn't actually in sources
  const sourceBlob = JSON.stringify(sources);
  result.recent_specifics = (result.recent_specifics ?? []).filter(
    (f: Row) => f.source_url && sourceBlob.includes(f.source_url)
  );
  return result;
}

// ── writer + QA gates (§9.2) ─────────────────────────────────────────────────
async function writeDraft(
  db: SupabaseClient,
  cl: Row,
  lead: Row,
  campaign: Row,
  brief: Row,
  sources: Row
): Promise<string> {
  const stepNo = cl.current_step + 1;
  const { data: step } = await db
    .from("sequence_steps")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("step_no", stepNo)
    .eq("variant", cl.variant ?? "A")
    .maybeSingle();
  if (!step) {
    await db.from("campaign_leads").update({ state: "finished", next_send_at: null }).eq("id", cl.id);
    return "no_step";
  }

  // already drafted? (a rejected draft is regenerated — upsert below replaces it)
  const { data: existing } = await db
    .from("drafts")
    .select("id, status")
    .eq("campaign_lead_id", cl.id)
    .eq("step_no", stepNo)
    .maybeSingle();
  if (existing && existing.status !== "rejected") return `draft_exists_${existing.status}`;

  const vars = leadVars(lead);
  const settings = campaign.settings ?? {};
  const slotNames = [...`${step.subject ?? ""} ${step.body}`.matchAll(/\{\{\s*(ai_[a-zA-Z0-9_]+)\s*\}\}/g)].map(
    (m) => m[1]
  );

  // no AI slots in this step → schedule directly, no draft needed
  if (!slotNames.length) {
    await scheduleLead(db, cl, lead, settings);
    return "no_ai_slots_scheduled";
  }

  const { data: knowledge } = await db
    .from("knowledge")
    .select("profile")
    .eq("workspace_id", campaign.workspace_id)
    .maybeSingle();
  const profile = knowledge?.profile ?? {};

  // slot instructions from the template library if the body came from one; default guidance otherwise
  const slotInstructions: Row = {};
  for (const name of slotNames) {
    slotInstructions[name] = { instruction: `Write the ${name.replace("ai_", "").replace(/_/g, " ")}.`, max_words: 35 };
  }

  const writeOnce = async (nudge: string) => {
    const system = `You write one personalised cold email slot-fill for a UK agency. Hard rules:
- UK English. Respect each slot's max_words cap.
- You MUST use at least one fact from brief.recent_specifics and cite its source_url as used_fact_source.
- No flattery clichés. Never use these phrases: ${[...bannedPhrases, ...(profile.banned_phrases ?? [])].join("; ")}.
- Avoid spammy wording (${spamWords.slice(0, 12).join(", ")}, …).
- Plain, specific, human. No exclamation marks. ${profile.tone_rules ?? ""}
${nudge}
Respond with strict JSON only: {"slots":{${slotNames.map((s) => `"${s}":"..."`).join(",")}},"used_fact_source":"<url>"}`;
    const user = JSON.stringify({
      template: { subject: step.subject, body: step.body },
      slot_instructions: slotInstructions,
      brief,
      profile: {
        what_we_sell: profile.what_we_sell,
        offer: profile.offer,
        proof_points: profile.proof_points,
        sender_name: profile.sender_name,
      },
      lead: vars,
    }).slice(0, 20_000);

    const { result } = await runChain(db, "ai_write", async (provider, apiKey) => {
      const raw = await aiComplete(provider, apiKey, system, user);
      try {
        return parseJson<Row>(raw);
      } catch {
        const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only, nothing else.", raw);
        return parseJson<Row>(retry);
      }
    });
    return result;
  };

  // ── code QA gates ──
  const qa: Row = { attempts: [] };
  let final: Row | null = null;
  let flagged = false;

  for (let attempt = 0; attempt < 3 && !final; attempt++) {
    const nudge =
      attempt === 0
        ? ""
        : attempt === 1
          ? "Your previous attempt failed QA. Fix the cited issues."
          : "Vary the structure substantially — different opening, different sentence shapes.";
    const out = await writeOnce(nudge);
    const issues: string[] = [];

    // gate 1: used_fact_source must be in brief.sources (§9.2)
    const sourceBlob = JSON.stringify(sources) + JSON.stringify(brief.recent_specifics ?? []);
    if (!out.used_fact_source || !sourceBlob.includes(out.used_fact_source)) {
      issues.push("used_fact_source not found in brief sources");
    }

    // gate 2: banned-phrase + spam-word lint
    const bodyRendered = renderVars(spin(step.body), vars, out.slots ?? {}).rendered;
    const haystack = bodyRendered.toLowerCase();
    for (const p of [...bannedPhrases, ...(profile.banned_phrases ?? [])]) {
      if (p && haystack.includes(p.toLowerCase())) issues.push(`banned phrase: "${p}"`);
    }

    // gate 3: link/attachment lint (max 2 links; attachments impossible by design)
    const links = bodyRendered.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
    if (links.length > 2) issues.push(`${links.length} links (max 2)`);

    // gate 4: slot word caps
    for (const [name, textVal] of Object.entries(out.slots ?? {})) {
      const cap = slotInstructions[name]?.max_words ?? 35;
      if (String(textVal).split(/\s+/).length > cap * 1.3) issues.push(`slot ${name} exceeds word cap`);
    }

    // gate 5: pg_trgm similarity vs last 200 sent in workspace > 0.85 → vary (§9.2)
    const { data: sim } = await db.rpc("max_body_similarity", {
      ws: campaign.workspace_id,
      candidate: bodyRendered,
    });
    if (typeof sim === "number" && sim > 0.85) issues.push(`too similar to recent sends (${sim.toFixed(2)})`);

    qa.attempts.push({ attempt, issues, used_fact_source: out.used_fact_source });
    if (!issues.length) {
      final = out;
      qa.body = bodyRendered;
    } else if (attempt === 2) {
      final = out; // out of retries → flag for human review
      flagged = true;
      qa.body = bodyRendered;
    }
  }

  const subjectRendered = renderVars(spin(step.subject ?? ""), vars, final!.slots ?? {}).rendered;
  const bodyFinal = renderVars(spin(step.body), vars, final!.slots ?? {}).rendered;

  // approve-first-N-then-auto (§1.7): count approved drafts across the campaign
  const approveFirstN = settings.approve_first_n ?? 10;
  const { count: approvedCount } = await db
    .from("drafts")
    .select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true })
    .eq("status", "approved")
    .eq("campaign_leads.campaign_id", campaign.id);
  const autoApprove = !flagged && (approvedCount ?? 0) >= approveFirstN;

  await db.from("drafts").upsert(
    {
      campaign_lead_id: cl.id,
      step_no: stepNo,
      subject: subjectRendered || null,
      body: bodyFinal,
      qa: { ...qa, flagged, used_fact_source: final!.used_fact_source, auto_approved: autoApprove },
      status: autoApprove ? "approved" : "pending",
      edited_body: null,
      edited_subject: null,
    },
    { onConflict: "campaign_lead_id,step_no" }
  );

  if (autoApprove) {
    await scheduleLead(db, cl, lead, settings);
    return "drafted_auto_approved";
  }
  await db.from("campaign_leads").update({ state: "awaiting_approval", next_send_at: null }).eq("id", cl.id);

  // nudge: approval queue ready
  const { count: pendingCount } = await db
    .from("drafts")
    .select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true })
    .eq("status", "pending")
    .eq("campaign_leads.campaign_id", campaign.id);
  if ((pendingCount ?? 0) === 10) {
    await queueNotification(db, campaign.workspace_id, "approval_queue_ready", {
      campaign: campaign.name,
      pending: pendingCount,
    });
  }
  return flagged ? "drafted_flagged" : "drafted_awaiting_approval";
}

async function scheduleLead(db: SupabaseClient, cl: Row, lead: Row, settings: Row) {
  const tz =
    settings.timezone_mode === "lead"
      ? (lead.timezone ?? settings.fixed_tz ?? "Europe/London")
      : (settings.fixed_tz ?? "Europe/London");
  const next = computeNextSendAt({
    base: new Date(),
    delayDays: 0,
    window: settings.send_window ?? {},
    timeZone: tz,
  });
  await db
    .from("campaign_leads")
    .update({ state: "scheduled", next_send_at: next.toISOString() })
    .eq("id", cl.id);
}
