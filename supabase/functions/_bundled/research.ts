// supabase/functions/_shared/db.ts
import { createClient } from "npm:@supabase/supabase-js@2";
function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
async function queueNotification(db, workspaceId, event, payload) {
  await db.from("notification_queue").insert({ workspace_id: workspaceId, event, payload });
}
async function onceToday(db, key) {
  const { error } = await db.from("alert_log").insert({ key, day: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) });
  return !error;
}

// supabase/functions/_shared/config.ts
var JITTER_MIN_S = 120;
var JITTER_MAX_S = 540;
var COMPLIANCE_HOUR_MIN = 6;
var COMPLIANCE_HOUR_MAX = 21;
var chains = {
  ai_write: [
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1e3 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 }
  ],
  ai_brief: [
    { provider: "anthropic", envKey: "ANTHROPIC_API_KEY", dailyQuota: 500 },
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1e3 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 }
  ],
  ai_classify: [
    { provider: "gemini", envKey: "GEMINI_API_KEY", dailyQuota: 1200 },
    { provider: "groq", envKey: "GROQ_API_KEY", dailyQuota: 1e3 },
    { provider: "openrouter", envKey: "OPENROUTER_API_KEY", dailyQuota: 150 }
  ],
  verify: [
    { provider: "reoon", envKey: "REOON_API_KEY", dailyQuota: 500 },
    { provider: "millionverifier", envKey: "MILLIONVERIFIER_API_KEY", dailyQuota: 200 },
    { provider: "zerobounce", envKey: "ZEROBOUNCE_API_KEY", dailyQuota: 100 },
    { provider: "hunter", envKey: "HUNTER_API_KEY", dailyQuota: 50 }
  ],
  scrape: [
    { provider: "jina", envKey: "JINA_API_KEY", dailyQuota: 500 },
    { provider: "firecrawl", envKey: "FIRECRAWL_API_KEY", dailyQuota: 30 }
  ],
  search: [
    { provider: "serper", envKey: "SERPER_API_KEY", dailyQuota: 80 },
    { provider: "tavily", envKey: "TAVILY_API_KEY", dailyQuota: 30 }
  ],
  linkedin: [{ provider: "apify", envKey: "APIFY_TOKEN", dailyQuota: 20 }]
};
var aiModels = {
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  anthropic: "claude-haiku-4-5-20251001"
};
var spamWords = [
  "100% free",
  "act now",
  "amazing deal",
  "apply now",
  "be your own boss",
  "buy now",
  "cash bonus",
  "cheap",
  "click here",
  "click below",
  "congratulations",
  "credit card",
  "double your",
  "earn extra cash",
  "exclusive deal",
  "fast cash",
  "free access",
  "free consultation",
  "free gift",
  "free money",
  "free trial",
  "get paid",
  "guarantee",
  "guaranteed",
  "increase sales",
  "instant",
  "limited time",
  "make money",
  "million dollars",
  "miracle",
  "no catch",
  "no cost",
  "no obligation",
  "no risk",
  "once in a lifetime",
  "order now",
  "prize",
  "promise you",
  "pure profit",
  "risk-free",
  "satisfaction guaranteed",
  "save big",
  "special promotion",
  "this won't last",
  "urgent",
  "winner",
  "work from home"
];
var bannedPhrases = [
  "i hope this email finds you well",
  "i came across your profile",
  "i was impressed by",
  "i couldn't help but notice",
  "as an ai",
  "in today's fast-paced world",
  "cutting-edge",
  "synergy",
  "revolutionize",
  "game-changer",
  "unlock the power",
  "take your business to the next level",
  "quick question",
  "just circling back",
  "just checking in",
  "touching base"
];

// supabase/functions/_shared/crypto.ts
function keyBytes() {
  const hex = Deno.env.get("ENCRYPTION_KEY");
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function aesKey() {
  return crypto.subtle.importKey("raw", keyBytes(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function decrypt(payload) {
  const buf = b64decode(payload);
  const key = await aesKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  return new TextDecoder().decode(pt);
}

// supabase/functions/_shared/providers.ts
var ChainExhaustedError = class extends Error {
  constructor(capability) {
    super(`Provider chain exhausted for capability: ${capability}`);
    this.capability = capability;
  }
};
async function getUsage(db, provider, capability) {
  const { data } = await db.from("provider_usage").select("used, failed").eq("provider", provider).eq("capability", capability).eq("day", (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).maybeSingle();
  return data ?? { used: 0, failed: 0 };
}
async function bumpUsage(db, provider, capability, field) {
  const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const current = await getUsage(db, provider, capability);
  await db.from("provider_usage").upsert(
    {
      provider,
      capability,
      day,
      used: current.used + (field === "used" ? 1 : 0),
      failed: current.failed + (field === "failed" ? 1 : 0)
    },
    { onConflict: "provider,capability,day" }
  );
}
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
function isQuotaError(err) {
  return /\b(429|402|quota|rate.?limit|resource.?exhausted|too many requests|insufficient|limit reached|exhaust)\b/i.test(
    String(err)
  );
}
async function candidatesFor(db, provider, envKey) {
  const out = [];
  const { data: rows } = await db.from("provider_keys").select("id, key_enc, exhausted_date, priority").eq("provider", provider).eq("active", true).order("priority");
  for (const r of rows ?? []) {
    if (r.exhausted_date === today()) continue;
    try {
      out.push({ key: await decrypt(r.key_enc), source: "db", id: r.id });
    } catch {
    }
  }
  if (envKey) out.push({ key: envKey, source: "env" });
  return out;
}
async function markExhausted(db, provider, cand) {
  if (cand.source === "db" && cand.id) {
    await db.from("provider_keys").update({ exhausted_date: today() }).eq("id", cand.id);
  }
  const { error } = await db.from("alert_log").insert({ key: `keyexhausted:${provider}`, day: today() });
  if (!error) {
    const { data: workspaces } = await db.from("workspaces").select("id");
    for (const ws of workspaces ?? []) {
      await db.from("notification_queue").insert({
        workspace_id: ws.id,
        event: "provider_quota_exhausted",
        payload: { provider, note: `${provider} hit its free daily limit \u2014 rotated to the next available key/provider.` }
      });
    }
  }
}
async function runChain(db, capability, task) {
  for (const entry of chains[capability]) {
    const envKey = Deno.env.get(entry.envKey);
    const candidates = await candidatesFor(db, entry.provider, envKey);
    if (!candidates.length) continue;
    for (const cand of candidates) {
      try {
        const result = await task(entry.provider, cand.key);
        await bumpUsage(db, entry.provider, capability, "used");
        return { result, provider: entry.provider };
      } catch (err) {
        console.error(`[runChain:${capability}] ${entry.provider}(${cand.source}) failed:`, String(err).slice(0, 200));
        await bumpUsage(db, entry.provider, capability, "failed");
        if (isQuotaError(err)) await markExhausted(db, entry.provider, cand);
      }
    }
  }
  throw new ChainExhaustedError(capability);
}
async function aiComplete(provider, apiKey, system, user) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiModels.gemini}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
        })
      }
    );
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return ((_e = (_d = (_c = (_b = (_a = data.candidates) == null ? void 0 : _a[0]) == null ? void 0 : _b.content) == null ? void 0 : _c.parts) == null ? void 0 : _d[0]) == null ? void 0 : _e.text) ?? "";
  }
  if (provider === "groq" || provider === "openrouter") {
    const url = provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModels[provider],
        temperature: 0.2,
        max_tokens: 1024,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!res.ok) throw new Error(`${provider} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return ((_h = (_g = (_f = data.choices) == null ? void 0 : _f[0]) == null ? void 0 : _g.message) == null ? void 0 : _h.content) ?? "";
  }
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: aiModels.anthropic,
        max_tokens: 1024,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return ((_j = (_i = data.content) == null ? void 0 : _i[0]) == null ? void 0 : _j.text) ?? "";
  }
  throw new Error(`unknown AI provider ${provider}`);
}
function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// supabase/functions/_shared/schedule.ts
var DEFAULT_WINDOW = { start: "08:30", end: "17:30", days: [1, 2, 3, 4, 5] };
function jitterSeconds() {
  return JITTER_MIN_S + Math.floor(Math.random() * (JITTER_MAX_S - JITTER_MIN_S));
}
function localParts(date, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false
    }).formatToParts(date);
  } catch {
    return localParts(date, "UTC");
  }
  const get = (t) => {
    var _a;
    return ((_a = parts.find((p) => p.type === t)) == null ? void 0 : _a.value) ?? "";
  };
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { minutes: hour * 60 + minute, isoDay: dayMap[get("weekday")] ?? 1 };
}
function hmToMinutes(hm) {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function snapIntoWindow(candidate, window, timeZone) {
  var _a;
  const win = { ...DEFAULT_WINDOW, ...window };
  const startM = hmToMinutes(win.start);
  const endM = hmToMinutes(win.end);
  const compMin = COMPLIANCE_HOUR_MIN * 60;
  const compMax = COMPLIANCE_HOUR_MAX * 60;
  const days = ((_a = win.days) == null ? void 0 : _a.length) ? win.days : DEFAULT_WINDOW.days;
  let t = new Date(candidate);
  for (let i = 0; i < 14 * 24 * 60 / 15; i++) {
    const { minutes, isoDay } = localParts(t, timeZone);
    const inWindow = days.includes(isoDay) && minutes >= startM && minutes <= endM;
    const inCompliance = minutes >= compMin && minutes <= compMax;
    if (inWindow && inCompliance) return t;
    t = new Date(t.getTime() + 15 * 6e4);
  }
  return t;
}
function computeNextSendAt(args) {
  const withDelay = new Date(args.base.getTime() + args.delayDays * 864e5);
  const withJitter = new Date(withDelay.getTime() + jitterSeconds() * 1e3);
  return snapIntoWindow(withJitter, args.window, args.timeZone);
}

// supabase/functions/_shared/render.ts
function spin(text) {
  let out = text;
  for (let i = 0; i < 20; i++) {
    const m = out.match(/\{([^{}]*\|[^{}]*)\}/);
    if (!m) break;
    const options = m[1].split("|");
    out = out.slice(0, m.index) + options[Math.floor(Math.random() * options.length)] + out.slice(m.index + m[0].length);
  }
  return out;
}
function leadVars(lead) {
  return {
    email: lead.email ?? "",
    first_name: lead.first_name ?? "",
    last_name: lead.last_name ?? "",
    full_name: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    company: lead.company ?? "",
    domain: lead.domain ?? "",
    title: lead.title ?? "",
    ...Object.fromEntries(
      Object.entries(lead.custom ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
    )
  };
}
function renderVars(text, vars, slots = {}) {
  const missing = [];
  const rendered = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    if (name.startsWith("ai_")) {
      if (slots[name] !== void 0) return slots[name];
      missing.push(name);
      return "";
    }
    if (vars[name] !== void 0 && vars[name] !== "") return vars[name];
    missing.push(name);
    return "";
  });
  return { rendered, missing };
}

// supabase/functions/research/index.ts
var CACHE_TTL_DAYS = 30;
var CRON_AUTH = Deno.env.get("CRON_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___never___";
Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(CRON_AUTH)) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = serviceClient();
  const { batch = 5 } = await req.json().catch(() => ({}));
  const { data: cls } = await db.from("campaign_leads").select("*, campaigns!inner(id, workspace_id, name, status, settings), leads!inner(*)").in("state", ["queued", "researching"]).eq("campaigns.status", "running").order("created_at").limit(batch);
  const results = {};
  for (const cl of cls ?? []) {
    try {
      results[cl.id] = await processOne(db, cl);
    } catch (err) {
      console.error(`research failed for ${cl.id}:`, err);
      if (err instanceof ChainExhaustedError) {
        if (await onceToday(db, `chain:${err.capability}`)) {
          await queueNotification(db, cl.campaigns.workspace_id, "provider_quota_exhausted", {
            capability: err.capability
          });
        }
        results[cl.id] = `chain exhausted: ${err.capability} \u2014 retrying next tick`;
      } else {
        results[cl.id] = `error: ${String(err).slice(0, 200)}`;
      }
    }
  }
  return Response.json(results);
});
async function processOne(db, cl) {
  const lead = cl.leads;
  const campaign = cl.campaigns;
  if (cl.state === "queued") {
    await gatherResearch(db, cl, lead, campaign);
    await db.from("campaign_leads").update({ state: "researching" }).eq("id", cl.id);
    return "researched";
  }
  const { data: research } = await db.from("lead_research").select("*").eq("lead_id", lead.id).maybeSingle();
  let brief = research == null ? void 0 : research.brief;
  if (!brief) {
    brief = await buildBrief(db, lead, campaign, (research == null ? void 0 : research.sources) ?? {});
    await db.from("lead_research").upsert({ lead_id: lead.id, brief, sources: (research == null ? void 0 : research.sources) ?? {}, status: "done", updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    return "brief_built";
  }
  return await writeDraft(db, cl, lead, campaign, brief, (research == null ? void 0 : research.sources) ?? {});
}
async function gatherResearch(db, cl, lead, campaign) {
  const sources = {};
  const domain = lead.domain ?? lead.email.split("@")[1];
  const { data: cached } = await db.from("domain_research_cache").select("*").eq("domain", domain).maybeSingle();
  const fresh = cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_DAYS * 864e5;
  if (fresh) {
    sources.site = cached.content;
  } else {
    const site = await scrapeSite(db, domain);
    if (site) {
      sources.site = site;
      await db.from("domain_research_cache").upsert({ domain, content: site, fetched_at: (/* @__PURE__ */ new Date()).toISOString() });
    }
  }
  const settings = campaign.settings ?? {};
  if (settings.linkedin_enrichment && lead.linkedin_url && Deno.env.get("APIFY_TOKEN")) {
    try {
      const { result } = await runChain(db, "linkedin", async (_provider, apiKey) => {
        const res = await fetch(
          `https://api.apify.com/v2/acts/apify~linkedin-profile-scraper/run-sync-get-dataset-items?token=${apiKey}&timeout=60`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profileUrls: [lead.linkedin_url] })
          }
        );
        if (!res.ok) throw new Error(`apify ${res.status}`);
        const items = await res.json();
        return (items == null ? void 0 : items[0]) ?? null;
      });
      if (result) sources.linkedin = result;
    } catch {
    }
  }
  try {
    const query = lead.company ? `"${lead.company}" news` : `${domain} news`;
    const { result } = await runChain(db, "search", async (provider, apiKey) => {
      if (provider === "serper") {
        const res = await fetch("https://google.serper.dev/news", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 5 })
        });
        if (!res.ok) throw new Error(`serper ${res.status}`);
        const data = await res.json();
        return (data.news ?? []).slice(0, 5).map((n) => ({ title: n.title, snippet: n.snippet, url: n.link, date: n.date }));
      }
      if (provider === "tavily") {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, query, max_results: 5, topic: "news" })
        });
        if (!res.ok) throw new Error(`tavily ${res.status}`);
        const data = await res.json();
        return (data.results ?? []).slice(0, 5).map((r) => {
          var _a;
          return { title: r.title, snippet: (_a = r.content) == null ? void 0 : _a.slice(0, 300), url: r.url };
        });
      }
      throw new Error(`unknown search provider ${provider}`);
    });
    if (result == null ? void 0 : result.length) sources.news = result;
  } catch {
  }
  await db.from("lead_research").upsert({
    lead_id: lead.id,
    sources,
    status: "running",
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function scrapeSite(db, domain) {
  const pages = {};
  for (const path of ["", "/about"]) {
    try {
      const res = await fetch(`https://${domain}${path}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SocivoResearch/1.0)" },
        redirect: "follow",
        signal: AbortSignal.timeout(1e4)
      });
      if (res.ok) {
        const html = await res.text();
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6e3);
        if (text.length > 200) pages[path || "/"] = { url: `https://${domain}${path}`, text };
      }
    } catch {
    }
  }
  if (Object.keys(pages).length) return pages;
  try {
    const { result } = await runChain(db, "scrape", async (provider, apiKey) => {
      var _a;
      if (provider === "jina") {
        const res = await fetch(`https://r.jina.ai/https://${domain}`, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(2e4)
        });
        if (!res.ok) throw new Error(`jina ${res.status}`);
        return { "/": { url: `https://${domain}`, text: (await res.text()).slice(0, 6e3) } };
      }
      if (provider === "firecrawl") {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://${domain}`, formats: ["markdown"] })
        });
        if (!res.ok) throw new Error(`firecrawl ${res.status}`);
        const data = await res.json();
        return { "/": { url: `https://${domain}`, text: (((_a = data.data) == null ? void 0 : _a.markdown) ?? "").slice(0, 6e3) } };
      }
      throw new Error(`unknown scrape provider ${provider}`);
    });
    return result;
  } catch {
    return null;
  }
}
async function buildBrief(db, lead, campaign, sources) {
  const { data: knowledge } = await db.from("knowledge").select("profile").eq("workspace_id", campaign.workspace_id).maybeSingle();
  const profile = (knowledge == null ? void 0 : knowledge.profile) ?? {};
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
      domain: lead.domain
    },
    our_profile: {
      what_we_sell: profile.what_we_sell,
      offer: profile.offer,
      icp: profile.icp,
      pains: profile.pains
    },
    sources
  }).slice(0, 24e3);
  const { result } = await runChain(db, "ai_brief", async (provider, apiKey) => {
    const raw = await aiComplete(provider, apiKey, system, user);
    try {
      return parseJson(raw);
    } catch {
      const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only, nothing else.", raw);
      return parseJson(retry);
    }
  });
  const sourceBlob = JSON.stringify(sources);
  result.recent_specifics = (result.recent_specifics ?? []).filter(
    (f) => f.source_url && sourceBlob.includes(f.source_url)
  );
  return result;
}
async function writeDraft(db, cl, lead, campaign, brief, sources) {
  var _a;
  const stepNo = cl.current_step + 1;
  const { data: step } = await db.from("sequence_steps").select("*").eq("campaign_id", campaign.id).eq("step_no", stepNo).eq("variant", cl.variant ?? "A").maybeSingle();
  if (!step) {
    await db.from("campaign_leads").update({ state: "finished", next_send_at: null }).eq("id", cl.id);
    return "no_step";
  }
  const { data: existing } = await db.from("drafts").select("id, status").eq("campaign_lead_id", cl.id).eq("step_no", stepNo).maybeSingle();
  if (existing && existing.status !== "rejected") return `draft_exists_${existing.status}`;
  const vars = leadVars(lead);
  const settings = campaign.settings ?? {};
  const slotNames = [...`${step.subject ?? ""} ${step.body}`.matchAll(/\{\{\s*(ai_[a-zA-Z0-9_]+)\s*\}\}/g)].map(
    (m) => m[1]
  );
  if (!slotNames.length) {
    await scheduleLead(db, cl, lead, settings);
    return "no_ai_slots_scheduled";
  }
  const { data: knowledge } = await db.from("knowledge").select("profile").eq("workspace_id", campaign.workspace_id).maybeSingle();
  const profile = (knowledge == null ? void 0 : knowledge.profile) ?? {};
  const slotInstructions = {};
  for (const name of slotNames) {
    slotInstructions[name] = { instruction: `Write the ${name.replace("ai_", "").replace(/_/g, " ")}.`, max_words: 35 };
  }
  const writeOnce = async (nudge) => {
    const system = `You write one personalised cold email slot-fill for a UK agency. Hard rules:
- UK English. Respect each slot's max_words cap.
- You MUST use at least one fact from brief.recent_specifics and cite its source_url as used_fact_source.
- No flattery clich\xE9s. Never use these phrases: ${[...bannedPhrases, ...profile.banned_phrases ?? []].join("; ")}.
- Avoid spammy wording (${spamWords.slice(0, 12).join(", ")}, \u2026).
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
        sender_name: profile.sender_name
      },
      lead: vars
    }).slice(0, 2e4);
    const { result } = await runChain(db, "ai_write", async (provider, apiKey) => {
      const raw = await aiComplete(provider, apiKey, system, user);
      try {
        return parseJson(raw);
      } catch {
        const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only, nothing else.", raw);
        return parseJson(retry);
      }
    });
    return result;
  };
  const qa = { attempts: [] };
  let final = null;
  let flagged = false;
  for (let attempt = 0; attempt < 3 && !final; attempt++) {
    const nudge = attempt === 0 ? "" : attempt === 1 ? "Your previous attempt failed QA. Fix the cited issues." : "Vary the structure substantially \u2014 different opening, different sentence shapes.";
    const out = await writeOnce(nudge);
    const issues = [];
    const sourceBlob = JSON.stringify(sources) + JSON.stringify(brief.recent_specifics ?? []);
    if (!out.used_fact_source || !sourceBlob.includes(out.used_fact_source)) {
      issues.push("used_fact_source not found in brief sources");
    }
    const bodyRendered = renderVars(spin(step.body), vars, out.slots ?? {}).rendered;
    const haystack = bodyRendered.toLowerCase();
    for (const p of [...bannedPhrases, ...profile.banned_phrases ?? []]) {
      if (p && haystack.includes(p.toLowerCase())) issues.push(`banned phrase: "${p}"`);
    }
    const links = bodyRendered.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
    if (links.length > 2) issues.push(`${links.length} links (max 2)`);
    for (const [name, textVal] of Object.entries(out.slots ?? {})) {
      const cap = ((_a = slotInstructions[name]) == null ? void 0 : _a.max_words) ?? 35;
      if (String(textVal).split(/\s+/).length > cap * 1.3) issues.push(`slot ${name} exceeds word cap`);
    }
    const { data: sim } = await db.rpc("max_body_similarity", {
      ws: campaign.workspace_id,
      candidate: bodyRendered
    });
    if (typeof sim === "number" && sim > 0.85) issues.push(`too similar to recent sends (${sim.toFixed(2)})`);
    qa.attempts.push({ attempt, issues, used_fact_source: out.used_fact_source });
    if (!issues.length) {
      final = out;
      qa.body = bodyRendered;
    } else if (attempt === 2) {
      final = out;
      flagged = true;
      qa.body = bodyRendered;
    }
  }
  const subjectRendered = renderVars(spin(step.subject ?? ""), vars, final.slots ?? {}).rendered;
  const bodyFinal = renderVars(spin(step.body), vars, final.slots ?? {}).rendered;
  const approveFirstN = settings.approve_first_n ?? 10;
  const { count: approvedCount } = await db.from("drafts").select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true }).eq("status", "approved").eq("campaign_leads.campaign_id", campaign.id);
  const autoApprove = !flagged && (approvedCount ?? 0) >= approveFirstN;
  await db.from("drafts").upsert(
    {
      campaign_lead_id: cl.id,
      step_no: stepNo,
      subject: subjectRendered || null,
      body: bodyFinal,
      qa: { ...qa, flagged, used_fact_source: final.used_fact_source, auto_approved: autoApprove },
      status: autoApprove ? "approved" : "pending",
      edited_body: null,
      edited_subject: null
    },
    { onConflict: "campaign_lead_id,step_no" }
  );
  if (autoApprove) {
    await scheduleLead(db, cl, lead, settings);
    return "drafted_auto_approved";
  }
  await db.from("campaign_leads").update({ state: "awaiting_approval", next_send_at: null }).eq("id", cl.id);
  const { count: pendingCount } = await db.from("drafts").select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true }).eq("status", "pending").eq("campaign_leads.campaign_id", campaign.id);
  if ((pendingCount ?? 0) === 10) {
    await queueNotification(db, campaign.workspace_id, "approval_queue_ready", {
      campaign: campaign.name,
      pending: pendingCount
    });
  }
  return flagged ? "drafted_flagged" : "drafted_awaiting_approval";
}
async function scheduleLead(db, cl, lead, settings) {
  const tz = settings.timezone_mode === "lead" ? lead.timezone ?? settings.fixed_tz ?? "Europe/London" : settings.fixed_tz ?? "Europe/London";
  const next = computeNextSendAt({
    base: /* @__PURE__ */ new Date(),
    delayDays: 0,
    window: settings.send_window ?? {},
    timeZone: tz
  });
  await db.from("campaign_leads").update({ state: "scheduled", next_send_at: next.toISOString() }).eq("id", cl.id);
}
