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
function b64encode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(bytes) {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function aesKey() {
  return crypto.subtle.importKey("raw", keyBytes(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encrypt(plaintext) {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext))
  );
  const buf = new Uint8Array(12 + ct.length);
  buf.set(iv, 0);
  buf.set(ct, 12);
  return b64encode(buf);
}
async function decrypt(payload) {
  const buf = b64decode(payload);
  const key = await aesKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  return new TextDecoder().decode(pt);
}
async function signToken(payload) {
  const data = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", keyBytes(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}
async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// supabase/functions/_shared/config.ts
var ramp = [
  { week: 1, cap: 8 },
  { week: 2, cap: 15 },
  { week: 3, cap: 25 }
];
var HARD_MAX_DAILY_CAP = 50;
function effectiveCap(rampStartedAt, dailyCap, today = /* @__PURE__ */ new Date()) {
  const start = new Date(rampStartedAt);
  const days = Math.floor((today.getTime() - start.getTime()) / 864e5);
  const week = Math.floor(Math.max(0, days) / 7) + 1;
  const capped = Math.min(dailyCap, HARD_MAX_DAILY_CAP);
  const entry = ramp.find((r) => r.week === week);
  return entry ? Math.min(entry.cap, capped) : capped;
}
var JITTER_MIN_S = 120;
var JITTER_MAX_S = 540;
var DEFAULT_DAILY_DOMAIN_CAP = 5;
var COMPLIANCE_HOUR_MIN = 6;
var COMPLIANCE_HOUR_MAX = 21;
var BREAKER_TRAILING_SENDS = 50;
var BREAKER_BOUNCE_RATE = 0.03;
var BREAKER_MAILBOX_FAILURES = 3;
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
var MAX_DAILY_FAILURES = 3;
var aiModels = {
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  anthropic: "claude-haiku-4-5-20251001"
};
var freeDomains = /* @__PURE__ */ new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru"
]);

// supabase/functions/_shared/providers.ts
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64UrlEncode(s) {
  return b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function encodeHeaderWord(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${b64(s)}?=`;
}
function generateMessageId(domain) {
  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `<${rand}@${domain}>`;
}
function buildMime(input) {
  var _a;
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const fromHeader = input.from.name ? `${encodeHeaderWord(input.from.name)} <${input.from.email}>` : input.from.email;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Message-ID: ${input.messageId}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    "MIME-Version: 1.0"
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if ((_a = input.references) == null ? void 0 : _a.length) headers.push(`References: ${input.references.join(" ")}`);
  if (input.listUnsubscribe) {
    headers.push(`List-Unsubscribe: <${input.listUnsubscribe}>`);
    headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  let body;
  if (input.html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(input.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(input.html),
      `--${boundary}--`
    ].join("\r\n");
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    body = b64(input.text);
  }
  return headers.join("\r\n") + "\r\n\r\n" + body;
}
async function refreshGoogleToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) throw new Error(`google refresh ${res.status}: ${await res.text()}`);
  return res.json();
}
async function refreshMsToken(refreshToken) {
  const res = await fetch(
    `https://login.microsoftonline.com/${Deno.env.get("MS_TENANT") || "common"}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: Deno.env.get("MS_CLIENT_ID") ?? "",
        client_secret: Deno.env.get("MS_CLIENT_SECRET") ?? "",
        grant_type: "refresh_token",
        scope: "offline_access Mail.Send Mail.ReadWrite User.Read"
      })
    }
  );
  if (!res.ok) throw new Error(`ms refresh ${res.status}: ${await res.text()}`);
  return res.json();
}
var GMAIL = "https://gmail.googleapis.com/gmail/v1";
async function gmailSend(accessToken, rawBase64Url, threadId) {
  const res = await fetch(`${GMAIL}/users/me/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(threadId ? { raw: rawBase64Url, threadId } : { raw: rawBase64Url })
  });
  if (!res.ok) throw new Error(`gmail send ${res.status}: ${await res.text()}`);
  return res.json();
}
async function gmailProfile(accessToken) {
  const res = await fetch(`${GMAIL}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`gmail profile ${res.status}`);
  return res.json();
}
async function gmailHistoryList(accessToken, startHistoryId) {
  const url = new URL(`${GMAIL}/users/me/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) throw Object.assign(new Error("history expired"), { code: "HISTORY_EXPIRED" });
  if (!res.ok) throw new Error(`gmail history ${res.status}`);
  return res.json();
}
async function gmailListRecent(accessToken) {
  const url = new URL(`${GMAIL}/users/me/messages`);
  url.searchParams.set("q", "in:inbox newer_than:2d");
  url.searchParams.set("maxResults", "25");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`gmail list ${res.status}`);
  return res.json();
}
async function gmailGetMessage(accessToken, id) {
  const res = await fetch(`${GMAIL}/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`gmail get ${res.status}`);
  return res.json();
}
function gmailHeader(msg, name) {
  var _a, _b, _c;
  return (_c = (_b = (_a = msg.payload) == null ? void 0 : _a.headers) == null ? void 0 : _b.find((h) => h.name.toLowerCase() === name.toLowerCase())) == null ? void 0 : _c.value;
}
function gmailPlainText(msg) {
  function decode(data) {
    const pad = data.length % 4 === 0 ? "" : "=".repeat(4 - data.length % 4);
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function walk(p) {
    var _a;
    if (!p) return null;
    if (p.mimeType === "text/plain" && ((_a = p.body) == null ? void 0 : _a.data)) return decode(p.body.data);
    for (const part of p.parts ?? []) {
      const found = walk(part);
      if (found) return found;
    }
    return null;
  }
  return walk(msg.payload) ?? msg.snippet ?? "";
}
var GRAPH = "https://graph.microsoft.com/v1.0";
async function graphSendMail(accessToken, args) {
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: args.subject,
        body: { contentType: args.html ? "HTML" : "Text", content: args.html ?? args.text },
        toRecipients: [{ emailAddress: { address: args.to } }]
      },
      saveToSentItems: true
    })
  });
  if (!res.ok) throw new Error(`graph sendMail ${res.status}: ${await res.text()}`);
  const q = new URL(`${GRAPH}/me/mailFolders/SentItems/messages`);
  q.searchParams.set("$top", "5");
  q.searchParams.set("$orderby", "sentDateTime desc");
  q.searchParams.set("$select", "id,conversationId,internetMessageId,toRecipients,subject");
  const sent = await fetch(q, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!sent.ok) return null;
  const data = await sent.json();
  return data.value.find(
    (m) => m.subject === args.subject && m.toRecipients.some((r) => r.emailAddress.address.toLowerCase() === args.to.toLowerCase())
  ) ?? null;
}
async function graphReply(accessToken, originalMessageId, args) {
  const create = await fetch(`${GRAPH}/me/messages/${originalMessageId}/createReply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  if (!create.ok) throw new Error(`graph createReply ${create.status}: ${await create.text()}`);
  const draft = await create.json();
  const patch = await fetch(`${GRAPH}/me/messages/${draft.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      body: { contentType: args.html ? "HTML" : "Text", content: args.html ?? args.text },
      toRecipients: [{ emailAddress: { address: args.to } }]
    })
  });
  if (!patch.ok) throw new Error(`graph patch ${patch.status}: ${await patch.text()}`);
  const patched = await patch.json();
  const send = await fetch(`${GRAPH}/me/messages/${draft.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!send.ok) throw new Error(`graph send ${send.status}: ${await send.text()}`);
  return patched;
}
async function graphInboxDelta(accessToken, deltaLink) {
  let url = deltaLink ?? `${GRAPH}/me/mailFolders/Inbox/messages/delta?$select=id,conversationId,internetMessageId,subject,bodyPreview,from,receivedDateTime`;
  const messages = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) throw Object.assign(new Error("delta expired"), { code: "DELTA_EXPIRED" });
    if (!res.ok) throw new Error(`graph delta ${res.status}`);
    const data = await res.json();
    messages.push(...data.value);
    if (data["@odata.deltaLink"]) return { messages, deltaLink: data["@odata.deltaLink"] };
    if (!data["@odata.nextLink"]) return { messages };
    url = data["@odata.nextLink"];
  }
  return { messages };
}
async function graphGetMessage(accessToken, id) {
  const res = await fetch(
    `${GRAPH}/me/messages/${id}?$select=id,conversationId,internetMessageId,subject,bodyPreview,body,from,receivedDateTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`graph get ${res.status}`);
  return res.json();
}
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
async function runChain(db, capability, task) {
  for (const entry of chains[capability]) {
    const apiKey = Deno.env.get(entry.envKey);
    if (!apiKey) continue;
    const usage = await getUsage(db, entry.provider, capability);
    if (usage.used >= entry.dailyQuota || usage.failed >= MAX_DAILY_FAILURES) continue;
    try {
      const result = await task(entry.provider, apiKey);
      await bumpUsage(db, entry.provider, capability, "used");
      return { result, provider: entry.provider };
    } catch (err) {
      console.error(`[runChain:${capability}] ${entry.provider} failed:`, String(err).slice(0, 300));
      await bumpUsage(db, entry.provider, capability, "failed");
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
function addBusinessDays(from, n, timeZone) {
  let t = new Date(from);
  let added = 0;
  while (added < n) {
    t = new Date(t.getTime() + 864e5);
    const { isoDay } = localParts(t, timeZone);
    if (isoDay <= 5) added++;
  }
  return t;
}
function inComplianceHours(date, timeZone) {
  const { minutes } = localParts(date, timeZone);
  return minutes >= COMPLIANCE_HOUR_MIN * 60 && minutes <= COMPLIANCE_HOUR_MAX * 60;
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
function assembleBody(args) {
  const footerLines = [];
  if (args.footerIdentity) footerLines.push(args.footerIdentity);
  if (args.usTargeting && args.postalAddress) footerLines.push(args.postalAddress);
  footerLines.push(`Don't want to hear from me again? Unsubscribe: ${args.unsubscribeUrl}`);
  const text = `${args.body.trim()}

--
${footerLines.join("\n")}`;
  if (args.plainText) return { text };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let htmlBody = esc(args.body.trim()).replace(/\n/g, "<br>");
  if (args.clickWrapper) {
    htmlBody = htmlBody.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
      const wrapped = args.clickWrapper(url);
      return `<a href="${wrapped}">${url}</a>`;
    });
  }
  const htmlFooter = footerLines.map(
    (l) => l.includes(args.unsubscribeUrl) ? `Don't want to hear from me again? <a href="${args.unsubscribeUrl}">Unsubscribe</a>` : esc(l).replace(/\n/g, "<br>")
  ).join("<br>");
  const pixel = args.trackingPixelUrl ? `<img src="${args.trackingPixelUrl}" width="1" height="1" alt="" style="display:none">` : "";
  const html = `<div>${htmlBody}${args.signatureHtml ? `<br><br>${args.signatureHtml}` : ""}<br><br><span style="color:#6B6B76;font-size:12px">--<br>${htmlFooter}</span>${pixel}</div>`;
  return { text, html };
}

// supabase/functions/tick/index.ts
var SEND_BATCH = 20;
var POLL_MAILBOXES = 10;
var RESEARCH_BATCH = 5;
var CRON_AUTH = Deno.env.get("CRON_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___never___";
Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(CRON_AUTH)) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = serviceClient();
  const report = {};
  const steps = [
    ["rollover", () => dayRollover(db)],
    ["token_refresh", () => tokenRefresh(db)],
    ["send_due", () => sendDue(db)],
    ["reply_poll", () => replyPoll(db)],
    ["research", () => invokeResearch()],
    ["breakers", () => breakers(db)],
    ["notifications", () => flushNotifications(db)],
    ["digests", () => dailyDigests(db)]
  ];
  for (const [name, fn] of steps) {
    try {
      report[name] = await fn() ?? "ok";
    } catch (err) {
      console.error(`[tick:${name}]`, err);
      report[name] = `error: ${String(err).slice(0, 300)}`;
    }
  }
  return Response.json(report);
});
async function dayRollover(db) {
  await db.from("mailboxes").update({ sent_today: 0, sent_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }).neq("sent_date", (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
}
async function tokenRefresh(db) {
  const soon = new Date(Date.now() + 10 * 6e4).toISOString();
  const { data: due } = await db.from("mailboxes").select("*").eq("status", "active").or(`access_token_expires_at.is.null,access_token_expires_at.lt.${soon}`).limit(10);
  let refreshed = 0;
  for (const mb of due ?? []) {
    if (!mb.refresh_token_enc) continue;
    try {
      const rt = await decrypt(mb.refresh_token_enc);
      const tokens = mb.provider === "google" ? await refreshGoogleToken(rt) : await refreshMsToken(rt);
      const update = {
        access_token_enc: await encrypt(tokens.access_token),
        access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1e3).toISOString()
      };
      if (tokens.refresh_token) update.refresh_token_enc = await encrypt(tokens.refresh_token);
      await db.from("mailboxes").update(update).eq("id", mb.id);
      refreshed++;
    } catch (err) {
      console.error(`token refresh failed for ${mb.email}:`, err);
      await db.from("mailboxes").update({ status: "auth_error" }).eq("id", mb.id);
      await queueNotification(db, mb.workspace_id, "mailbox_disconnected", {
        mailbox: mb.email,
        error: String(err).slice(0, 200)
      });
    }
  }
  return { refreshed };
}
async function accessTokenFor(db, mailbox) {
  const expiresAt = mailbox.access_token_expires_at ? new Date(mailbox.access_token_expires_at) : null;
  if (mailbox.access_token_enc && expiresAt && expiresAt.getTime() - Date.now() > 5 * 6e4) {
    return decrypt(mailbox.access_token_enc);
  }
  const rt = await decrypt(mailbox.refresh_token_enc);
  const tokens = mailbox.provider === "google" ? await refreshGoogleToken(rt) : await refreshMsToken(rt);
  const update = {
    access_token_enc: await encrypt(tokens.access_token),
    access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1e3).toISOString()
  };
  if (tokens.refresh_token) update.refresh_token_enc = await encrypt(tokens.refresh_token);
  await db.from("mailboxes").update(update).eq("id", mailbox.id);
  return tokens.access_token;
}
async function sendDue(db) {
  const { data: claimed, error } = await db.rpc("claim_due_sends", { batch: SEND_BATCH });
  if (error) throw new Error(error.message);
  if (!(claimed == null ? void 0 : claimed.length)) return { sent: 0 };
  let sent = 0;
  const usedMailboxes = /* @__PURE__ */ new Set();
  for (const cl of claimed) {
    try {
      const outcome = await sendOne(db, cl, usedMailboxes);
      if (outcome === "sent") sent++;
    } catch (err) {
      console.error(`send failed for campaign_lead ${cl.id}:`, err);
      await handleSendFailure(db, cl, String(err));
    }
  }
  return { sent, claimed: claimed.length };
}
async function sendOne(db, cl, usedMailboxes) {
  const [{ data: campaign }, { data: lead }, { data: mailbox }] = await Promise.all([
    db.from("campaigns").select("*").eq("id", cl.campaign_id).single(),
    db.from("leads").select("*").eq("id", cl.lead_id).single(),
    cl.mailbox_id ? db.from("mailboxes").select("*").eq("id", cl.mailbox_id).single() : Promise.resolve({ data: null })
  ]);
  if (!campaign || campaign.status !== "running") return "campaign_not_running";
  if (!lead) return "no_lead";
  if (!mailbox) {
    await stopLead(db, cl.id, "failed", "no mailbox assigned");
    return "no_mailbox";
  }
  const settings = campaign.settings ?? {};
  const stepNo = cl.current_step + 1;
  if (usedMailboxes.has(mailbox.id)) return "mailbox_used_this_tick";
  const email = lead.email.toLowerCase();
  const domain = email.split("@")[1];
  const { data: suppressed } = await db.from("suppression").select("id").or(`workspace_id.eq.${campaign.workspace_id},workspace_id.is.null`).or(`and(kind.eq.email,value.eq.${email}),and(kind.eq.domain,value.eq.${domain})`).limit(1);
  if (suppressed == null ? void 0 : suppressed.length) {
    await stopLead(db, cl.id, "unsubscribed", "suppressed at send time");
    return "suppressed";
  }
  if (freeDomains.has(domain) && !settings.allow_free_domains) {
    await stopLead(db, cl.id, "failed", "free consumer domain blocked");
    return "free_domain_blocked";
  }
  if (mailbox.status !== "active") return "mailbox_not_active";
  const cap = effectiveCap(mailbox.ramp_started_at, mailbox.daily_cap);
  const sentToday = mailbox.sent_date === (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) ? mailbox.sent_today : 0;
  if (sentToday >= cap) {
    const tz2 = tzFor(settings, lead);
    const tomorrow = snapIntoWindow(new Date(Date.now() + 12 * 36e5), settings.send_window ?? {}, tz2);
    await db.from("campaign_leads").update({ next_send_at: tomorrow.toISOString() }).eq("id", cl.id);
    return "mailbox_budget_exhausted";
  }
  const domainCap = settings.daily_domain_cap ?? DEFAULT_DAILY_DOMAIN_CAP;
  const dayStart = /* @__PURE__ */ new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: domainSends } = await db.from("messages").select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true }).eq("direction", "outbound").eq("campaign_leads.campaign_id", campaign.id).like("to_email", `%@${domain}`).gte("occurred_at", dayStart.toISOString());
  if ((domainSends ?? 0) >= domainCap) {
    const tz2 = tzFor(settings, lead);
    const tomorrow = snapIntoWindow(new Date(Date.now() + 12 * 36e5), settings.send_window ?? {}, tz2);
    await db.from("campaign_leads").update({ next_send_at: tomorrow.toISOString() }).eq("id", cl.id);
    return "domain_cap_reached";
  }
  const tz = tzFor(settings, lead);
  if (!inComplianceHours(/* @__PURE__ */ new Date(), tz)) {
    const next = snapIntoWindow(new Date(Date.now() + 15 * 6e4), settings.send_window ?? {}, tz);
    await db.from("campaign_leads").update({ next_send_at: next.toISOString() }).eq("id", cl.id);
    return "outside_compliance_hours";
  }
  const { data: step } = await db.from("sequence_steps").select("*").eq("campaign_id", campaign.id).eq("step_no", stepNo).eq("variant", cl.variant ?? "A").maybeSingle();
  const { data: fallbackStep } = step ? { data: null } : await db.from("sequence_steps").select("*").eq("campaign_id", campaign.id).eq("step_no", stepNo).eq("variant", "A").maybeSingle();
  const stepRow = step ?? fallbackStep;
  if (!stepRow) {
    await stopLead(db, cl.id, "finished", "no more steps");
    return "no_step";
  }
  const { data: draft } = await db.from("drafts").select("*").eq("campaign_lead_id", cl.id).eq("step_no", stepNo).eq("status", "approved").maybeSingle();
  const vars = leadVars(lead);
  let subject;
  let bodyCore;
  if (draft) {
    subject = draft.edited_subject ?? draft.subject ?? renderVars(spin(stepRow.subject ?? ""), vars).rendered;
    bodyCore = draft.edited_body ?? draft.body;
  } else {
    subject = renderVars(spin(stepRow.subject ?? ""), vars).rendered;
    const r = renderVars(spin(stepRow.body), vars);
    if (r.missing.some((m) => m.startsWith("ai_"))) {
      await db.from("campaign_leads").update({ state: "queued", next_send_at: null }).eq("id", cl.id);
      return "requeued_for_ai";
    }
    bodyCore = r.rendered;
  }
  let thread = null;
  if (stepNo > 1) {
    const { data: firstMsg } = await db.from("messages").select("*").eq("campaign_lead_id", cl.id).eq("direction", "outbound").order("occurred_at", { ascending: true }).limit(1).maybeSingle();
    thread = firstMsg;
  }
  const { data: knowledge } = await db.from("knowledge").select("profile").eq("workspace_id", campaign.workspace_id).maybeSingle();
  const profile = (knowledge == null ? void 0 : knowledge.profile) ?? {};
  const trackingDomain = Deno.env.get("TRACKING_DOMAIN") ?? "";
  const unsubToken = await signToken({ e: email, w: campaign.workspace_id, cl: cl.id });
  const unsubscribeUrl = `https://${trackingDomain}/u/${unsubToken}`;
  const plainText = settings.plain_text !== false;
  const msgToken = await signToken({ w: campaign.workspace_id, cl: cl.id, m: "" });
  const assembled = assembleBody({
    body: bodyCore,
    footerIdentity: profile.footer_identity,
    postalAddress: profile.postal_address,
    unsubscribeUrl,
    usTargeting: settings.us_targeting,
    signatureHtml: mailbox.signature_html,
    plainText,
    trackingPixelUrl: settings.track_opens && !plainText ? `https://${trackingDomain}/o/${msgToken}.gif` : void 0,
    clickWrapper: settings.track_clicks && !plainText ? (url) => `https://${trackingDomain}/r/${msgToken}?to=${encodeURIComponent(url)}` : void 0
  });
  const accessToken = await accessTokenFor(db, mailbox);
  let providerMessageId = null;
  let providerThreadId = null;
  let internetMessageId = null;
  const sendSubject = stepNo > 1 && (thread == null ? void 0 : thread.subject) ? `Re: ${thread.subject.replace(/^Re:\s*/i, "")}` : subject;
  if (mailbox.provider === "google") {
    const msgId = generateMessageId(mailbox.email.split("@")[1] ?? "mail");
    const raw = buildMime({
      from: { name: mailbox.display_name ?? void 0, email: mailbox.email },
      to: email,
      subject: sendSubject,
      text: assembled.text,
      html: assembled.html,
      messageId: msgId,
      inReplyTo: (thread == null ? void 0 : thread.internet_message_id) ?? void 0,
      references: (thread == null ? void 0 : thread.internet_message_id) ? [thread.internet_message_id] : void 0,
      listUnsubscribe: unsubscribeUrl
    });
    const res = await gmailSend(accessToken, base64UrlEncode(raw), (thread == null ? void 0 : thread.provider_thread_id) ?? void 0);
    providerMessageId = res.id;
    providerThreadId = res.threadId;
    internetMessageId = msgId;
  } else {
    if (stepNo > 1 && (thread == null ? void 0 : thread.provider_message_id)) {
      const res = await graphReply(accessToken, thread.provider_message_id, {
        to: email,
        text: assembled.text,
        html: assembled.html
      });
      providerMessageId = res.id;
      providerThreadId = res.conversationId ?? null;
      internetMessageId = res.internetMessageId ?? null;
    } else {
      const res = await graphSendMail(accessToken, {
        to: email,
        subject: sendSubject,
        text: assembled.text,
        html: assembled.html
      });
      providerMessageId = (res == null ? void 0 : res.id) ?? null;
      providerThreadId = (res == null ? void 0 : res.conversationId) ?? null;
      internetMessageId = (res == null ? void 0 : res.internetMessageId) ?? null;
    }
  }
  usedMailboxes.add(mailbox.id);
  await db.from("messages").insert({
    workspace_id: campaign.workspace_id,
    mailbox_id: mailbox.id,
    campaign_lead_id: cl.id,
    direction: "outbound",
    step_no: stepNo,
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    internet_message_id: internetMessageId,
    from_email: mailbox.email,
    to_email: email,
    subject: sendSubject,
    snippet: assembled.text.slice(0, 200),
    body: bodyCore,
    occurred_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  await db.rpc("bump_mailbox_sent", { mb: mailbox.id });
  const { data: nextSteps } = await db.from("sequence_steps").select("step_no, delay_days").eq("campaign_id", campaign.id).eq("step_no", stepNo + 1).limit(1);
  if (nextSteps == null ? void 0 : nextSteps.length) {
    const next = computeNextSendAt({
      base: /* @__PURE__ */ new Date(),
      delayDays: nextSteps[0].delay_days ?? 3,
      window: settings.send_window ?? {},
      timeZone: tz
    });
    await db.from("campaign_leads").update({ state: "in_sequence", current_step: stepNo, next_send_at: next.toISOString() }).eq("id", cl.id);
  } else {
    await db.from("campaign_leads").update({ state: "finished", current_step: stepNo, next_send_at: null }).eq("id", cl.id);
    await queueNotification(db, campaign.workspace_id, "sequence_finished", {
      campaign: campaign.name,
      lead: email
    });
  }
  return "sent";
}
function tzFor(settings, lead) {
  return settings.timezone_mode === "lead" ? lead.timezone ?? settings.fixed_tz ?? "Europe/London" : settings.fixed_tz ?? "Europe/London";
}
async function stopLead(db, clId, state, reason) {
  await db.from("campaign_leads").update({ state, next_send_at: null, stop_reason: reason }).eq("id", clId);
}
async function handleSendFailure(db, cl, error) {
  const { data: campaign } = await db.from("campaigns").select("workspace_id, name").eq("id", cl.campaign_id).single();
  if (campaign) {
    await db.from("events").insert({
      workspace_id: campaign.workspace_id,
      campaign_lead_id: cl.id,
      type: "send_fail",
      meta: { error: error.slice(0, 300) }
    });
  }
  await db.from("campaign_leads").update({ next_send_at: new Date(Date.now() + 30 * 6e4).toISOString() }).eq("id", cl.id);
  if (cl.mailbox_id) {
    const { data: mb } = await db.from("mailboxes").select("*").eq("id", cl.mailbox_id).single();
    if (mb) {
      const failures = (mb.consecutive_failures ?? 0) + 1;
      const authError = /401|invalid_grant|unauthorized/i.test(error);
      const update = {
        consecutive_failures: failures,
        health_score: Math.max(0, (mb.health_score ?? 100) - 10)
      };
      if (authError) update.status = "auth_error";
      else if (failures >= BREAKER_MAILBOX_FAILURES) update.status = "paused";
      await db.from("mailboxes").update(update).eq("id", mb.id);
      if (authError || failures >= BREAKER_MAILBOX_FAILURES) {
        await queueNotification(db, mb.workspace_id, authError ? "mailbox_disconnected" : "breaker_tripped", {
          mailbox: mb.email,
          reason: authError ? "auth error" : `${failures} consecutive send failures`
        });
      }
    }
  }
}
async function replyPoll(db) {
  const { data: mailboxes } = await db.from("mailboxes").select("*").eq("status", "active").order("last_polled_at", { ascending: true, nullsFirst: true }).limit(POLL_MAILBOXES);
  let processed = 0;
  for (const mb of mailboxes ?? []) {
    try {
      processed += await pollMailbox(db, mb);
    } catch (err) {
      console.error(`poll failed for ${mb.email}:`, err);
    }
    await db.from("mailboxes").update({ last_polled_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", mb.id);
  }
  return { processed };
}
async function pollMailbox(db, mb) {
  var _a, _b, _c, _d, _e;
  const accessToken = await accessTokenFor(db, mb);
  let count = 0;
  if (mb.provider === "google") {
    let ids = [];
    let newCursor;
    if (mb.poll_cursor) {
      try {
        const hist = await gmailHistoryList(accessToken, mb.poll_cursor);
        ids = (hist.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((m) => m.message.id));
        newCursor = hist.historyId ?? mb.poll_cursor;
      } catch (err) {
        if (err.code !== "HISTORY_EXPIRED") throw err;
        const recent = await gmailListRecent(accessToken);
        ids = (recent.messages ?? []).map((m) => m.id);
      }
    } else {
      const recent = await gmailListRecent(accessToken);
      ids = (recent.messages ?? []).map((m) => m.id);
    }
    if (!newCursor) {
      const profile = await gmailProfile(accessToken);
      newCursor = profile.historyId;
    }
    for (const id of ids.slice(0, 15)) {
      const msg = await gmailGetMessage(accessToken, id);
      const from = parseAddr(gmailHeader(msg, "From") ?? "");
      if (!from || from === mb.email.toLowerCase()) continue;
      const dedup = await alreadyStored(db, gmailHeader(msg, "Message-ID") ?? msg.id);
      if (dedup) continue;
      await handleInbound(db, mb, {
        from,
        subject: gmailHeader(msg, "Subject") ?? "",
        body: gmailPlainText(msg).slice(0, 8e3),
        snippet: msg.snippet ?? "",
        inReplyTo: gmailHeader(msg, "In-Reply-To") ?? null,
        references: gmailHeader(msg, "References") ?? "",
        internetMessageId: gmailHeader(msg, "Message-ID") ?? msg.id,
        providerMessageId: msg.id,
        providerThreadId: msg.threadId,
        occurredAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
      });
      count++;
    }
    await db.from("mailboxes").update({ poll_cursor: newCursor }).eq("id", mb.id);
  } else {
    let delta;
    try {
      delta = await graphInboxDelta(accessToken, mb.poll_cursor ?? void 0);
    } catch (err) {
      if (err.code !== "DELTA_EXPIRED") throw err;
      delta = await graphInboxDelta(accessToken, void 0);
    }
    for (const m of delta.messages.slice(0, 15)) {
      const from = (_b = (_a = m.from) == null ? void 0 : _a.emailAddress.address) == null ? void 0 : _b.toLowerCase();
      if (!from || from === mb.email.toLowerCase()) continue;
      if (!m.internetMessageId) continue;
      if (await alreadyStored(db, m.internetMessageId)) continue;
      const full = await graphGetMessage(accessToken, m.id);
      const bodyText = ((_d = (_c = full.body) == null ? void 0 : _c.contentType) == null ? void 0 : _d.toLowerCase()) === "html" ? (full.body.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : ((_e = full.body) == null ? void 0 : _e.content) ?? full.bodyPreview ?? "";
      await handleInbound(db, mb, {
        from,
        subject: m.subject ?? "",
        body: bodyText.slice(0, 8e3),
        snippet: m.bodyPreview ?? "",
        inReplyTo: null,
        references: "",
        internetMessageId: m.internetMessageId,
        providerMessageId: m.id,
        providerThreadId: m.conversationId ?? null,
        occurredAt: m.receivedDateTime ?? (/* @__PURE__ */ new Date()).toISOString()
      });
      count++;
    }
    if (delta.deltaLink) await db.from("mailboxes").update({ poll_cursor: delta.deltaLink }).eq("id", mb.id);
  }
  return count;
}
function parseAddr(header) {
  const m = header.match(/<([^>]+)>/);
  const addr = (m ? m[1] : header).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}
async function alreadyStored(db, internetMessageId) {
  const { data } = await db.from("messages").select("id").eq("internet_message_id", internetMessageId).eq("direction", "inbound").limit(1);
  return !!(data == null ? void 0 : data.length);
}
async function handleInbound(db, mb, msg) {
  const isBounceSender = /mailer-daemon|postmaster|mail delivery/i.test(msg.from) || /delivery status notification|undeliverable|delivery has failed|returned mail/i.test(msg.subject);
  let campaignLead = null;
  const refIds = [msg.inReplyTo, ...msg.references.split(/\s+/)].filter(Boolean);
  if (refIds.length) {
    const { data } = await db.from("messages").select("campaign_lead_id").in("internet_message_id", refIds).eq("direction", "outbound").not("campaign_lead_id", "is", null).limit(1);
    if (data == null ? void 0 : data.length) {
      const { data: cl } = await db.from("campaign_leads").select("*").eq("id", data[0].campaign_lead_id).single();
      campaignLead = cl;
    }
  }
  if (!campaignLead && !isBounceSender) {
    const { data: leadRows } = await db.from("leads").select("id").eq("email", msg.from);
    if (leadRows == null ? void 0 : leadRows.length) {
      const { data: cl } = await db.from("campaign_leads").select("*").in("lead_id", leadRows.map((l) => l.id)).eq("mailbox_id", mb.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      campaignLead = cl;
    }
  }
  if (!campaignLead && isBounceSender) {
    const emailsInBody = msg.body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
    const candidates = emailsInBody.map((e) => e.toLowerCase()).filter((e) => e !== mb.email.toLowerCase());
    if (candidates.length) {
      const { data: leadRows } = await db.from("leads").select("id").in("email", candidates);
      if (leadRows == null ? void 0 : leadRows.length) {
        const { data: cl } = await db.from("campaign_leads").select("*").in("lead_id", leadRows.map((l) => l.id)).eq("mailbox_id", mb.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        campaignLead = cl;
      }
    }
  }
  const { data: stored } = await db.from("messages").insert({
    workspace_id: mb.workspace_id,
    mailbox_id: mb.id,
    campaign_lead_id: (campaignLead == null ? void 0 : campaignLead.id) ?? null,
    direction: "inbound",
    provider_message_id: msg.providerMessageId,
    provider_thread_id: msg.providerThreadId,
    internet_message_id: msg.internetMessageId,
    in_reply_to: msg.inReplyTo,
    from_email: msg.from,
    to_email: mb.email,
    subject: msg.subject,
    snippet: msg.snippet.slice(0, 300),
    body: msg.body,
    occurred_at: msg.occurredAt
  }).select().single();
  if (!campaignLead || !stored) return;
  let category = "other";
  if (isBounceSender) {
    category = "bounce";
  } else if (/out of (the )?office|annual leave|on holiday|maternity|paternity|auto-?reply|automatic reply/i.test(`${msg.subject} ${msg.body.slice(0, 500)}`)) {
    category = "ooo";
  } else if (/\b(unsubscribe|remove me|stop emailing|take me off|opt me out|do not contact)\b/i.test(msg.body)) {
    category = "unsubscribe";
  } else {
    try {
      const { result } = await runChain(db, "ai_classify", async (provider, apiKey) => {
        const raw = await aiComplete(
          provider,
          apiKey,
          `You classify replies to cold outreach emails. Respond with strict JSON only: {"category":"<one of interested|info_request|not_now|not_interested|ooo|wrong_person|bounce|unsubscribe|other>","confidence":<0-1>}. Any request to stop emailing or remove from lists is "unsubscribe" regardless of wording.`,
          `Subject: ${msg.subject}

Body:
${msg.body.slice(0, 2e3)}`
        );
        try {
          return parseJson(raw);
        } catch {
          const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only.", raw);
          return parseJson(retry);
        }
      });
      const valid = [
        "interested",
        "info_request",
        "not_now",
        "not_interested",
        "ooo",
        "wrong_person",
        "bounce",
        "unsubscribe",
        "other"
      ];
      if (valid.includes(result.category)) category = result.category;
    } catch (err) {
      if (err instanceof ChainExhaustedError && await onceToday(db, "chain:ai_classify")) {
        await queueNotification(db, mb.workspace_id, "provider_quota_exhausted", { capability: "ai_classify" });
      }
    }
  }
  await db.from("messages").update({ category }).eq("id", stored.id);
  const positive = category === "interested" || category === "info_request";
  const { data: lead } = await db.from("leads").select("email").eq("id", campaignLead.lead_id).single();
  const { data: campaign } = await db.from("campaigns").select("name, workspace_id, settings").eq("id", campaignLead.campaign_id).single();
  if (category === "ooo") {
    if (campaignLead.next_send_at) {
      const pushed = addBusinessDays(new Date(campaignLead.next_send_at), 3, "Europe/London");
      await db.from("campaign_leads").update({ next_send_at: pushed.toISOString() }).eq("id", campaignLead.id);
    }
  } else if (category === "bounce") {
    await stopLead(db, campaignLead.id, "bounced", "bounce detected");
    await db.from("events").insert({
      workspace_id: mb.workspace_id,
      message_id: stored.id,
      campaign_lead_id: campaignLead.id,
      type: "bounce",
      meta: {}
    });
    await db.from("mailboxes").update({ health_score: Math.max(0, (mb.health_score ?? 100) - 5) }).eq("id", mb.id);
  } else if (category === "unsubscribe") {
    await stopLead(db, campaignLead.id, "unsubscribed", "asked to stop");
    if (lead) {
      await db.from("suppression").upsert(
        { workspace_id: null, value: lead.email.toLowerCase(), kind: "email", reason: "reply: asked to stop" },
        { onConflict: "workspace_id,value,kind", ignoreDuplicates: true }
      );
    }
    await db.from("events").insert({
      workspace_id: mb.workspace_id,
      message_id: stored.id,
      campaign_lead_id: campaignLead.id,
      type: "unsubscribe",
      meta: {}
    });
  } else {
    await stopLead(db, campaignLead.id, positive ? "positive" : "replied", `reply: ${category}`);
    await db.from("events").insert({
      workspace_id: mb.workspace_id,
      message_id: stored.id,
      campaign_lead_id: campaignLead.id,
      type: "reply",
      meta: { category }
    });
    await queueNotification(db, mb.workspace_id, positive ? "positive_reply" : "reply", {
      campaign: campaign == null ? void 0 : campaign.name,
      lead: lead == null ? void 0 : lead.email,
      category,
      snippet: msg.snippet.slice(0, 200)
    });
  }
  const webhookEvent = category === "bounce" ? "bounce" : category === "unsubscribe" ? "unsubscribe" : positive ? "positive_reply" : "reply";
  await deliverWebhooks(db, mb.workspace_id, webhookEvent, {
    lead: lead == null ? void 0 : lead.email,
    campaign: campaign == null ? void 0 : campaign.name,
    category,
    subject: msg.subject,
    snippet: msg.snippet.slice(0, 200)
  });
}
async function invokeResearch() {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/research`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_AUTH}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ batch: RESEARCH_BATCH })
  });
  return { status: res.status, body: (await res.text()).slice(0, 300) };
}
async function breakers(db) {
  const { data: running } = await db.from("campaigns").select("*").eq("status", "running");
  let tripped = 0;
  for (const c of running ?? []) {
    const { data: last } = await db.from("messages").select("campaign_lead_id, campaign_leads!inner(campaign_id)").eq("direction", "outbound").eq("is_seed", false).eq("campaign_leads.campaign_id", c.id).order("occurred_at", { ascending: false }).limit(BREAKER_TRAILING_SENDS);
    const clIds = [...new Set((last ?? []).map((m) => m.campaign_lead_id).filter(Boolean))];
    if (((last == null ? void 0 : last.length) ?? 0) < 10 || !clIds.length) continue;
    const { count: bounced } = await db.from("events").select("id", { count: "exact", head: true }).eq("type", "bounce").in("campaign_lead_id", clIds);
    const rate = (bounced ?? 0) / ((last == null ? void 0 : last.length) ?? 1);
    if (rate > BREAKER_BOUNCE_RATE) {
      await db.from("campaigns").update({ status: "paused" }).eq("id", c.id);
      await queueNotification(db, c.workspace_id, "breaker_tripped", {
        campaign: c.name,
        reason: `bounce rate ${(rate * 100).toFixed(1)}% over trailing ${last == null ? void 0 : last.length} sends`
      });
      tripped++;
    }
  }
  return { tripped };
}
async function flushNotifications(db) {
  const { data: pending } = await db.from("notification_queue").select("*").eq("status", "pending").lt("attempts", 3).limit(20);
  let dispatched = 0;
  for (const n of pending ?? []) {
    const { data: settings } = await db.from("notification_settings").select("*").eq("workspace_id", n.workspace_id).maybeSingle();
    const instant = (settings == null ? void 0 : settings.instant_events) ?? ["positive_reply", "breaker_tripped", "mailbox_disconnected"];
    if (!instant.includes(n.event)) {
      await db.from("notification_queue").update({ status: "digest" }).eq("id", n.id);
      continue;
    }
    const ok = await dispatchNotification(db, n, settings);
    await db.from("notification_queue").update({ status: ok ? "sent" : "pending", attempts: (n.attempts ?? 0) + 1 }).eq("id", n.id);
    if (ok) dispatched++;
  }
  return { dispatched };
}
async function dispatchNotification(db, n, settings) {
  const text = `[Socivo] ${n.event}: ${JSON.stringify(n.payload)}`;
  let anyOk = false;
  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
  if ((settings == null ? void 0 : settings.telegram) && tgToken && tgChat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text })
      });
      anyOk = anyOk || res.ok;
    } catch (err) {
      console.error("telegram notify failed:", err);
    }
  }
  const n8nUrl = Deno.env.get("N8N_WEBHOOK_URL");
  if ((settings == null ? void 0 : settings.n8n) && n8nUrl) {
    try {
      const res = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: n.event, workspace_id: n.workspace_id, payload: n.payload })
      });
      anyOk = anyOk || res.ok;
    } catch (err) {
      console.error("n8n notify failed:", err);
    }
  }
  if ((settings == null ? void 0 : settings.email_to) && (settings == null ? void 0 : settings.email_from_mailbox)) {
    try {
      const { data: mb } = await db.from("mailboxes").select("*").eq("id", settings.email_from_mailbox).single();
      if (mb && mb.status === "active") {
        const accessToken = await accessTokenFor(db, mb);
        const subject = `[Socivo] ${n.event.replace(/_/g, " ")}`;
        const body = `Event: ${n.event}

${JSON.stringify(n.payload, null, 2)}`;
        if (mb.provider === "google") {
          const raw = buildMime({
            from: { email: mb.email },
            to: settings.email_to,
            subject,
            text: body,
            messageId: generateMessageId(mb.email.split("@")[1] ?? "mail")
          });
          await gmailSend(accessToken, base64UrlEncode(raw));
        } else {
          await graphSendMail(accessToken, { to: settings.email_to, subject, text: body });
        }
        await db.from("messages").insert({
          workspace_id: n.workspace_id,
          mailbox_id: mb.id,
          direction: "outbound",
          from_email: mb.email,
          to_email: settings.email_to,
          subject,
          snippet: body.slice(0, 200),
          is_internal: true
        });
        anyOk = true;
      }
    } catch (err) {
      console.error("email notify failed:", err);
    }
  }
  return anyOk || !(settings == null ? void 0 : settings.telegram) && !(settings == null ? void 0 : settings.n8n) && !(settings == null ? void 0 : settings.email_to);
}
async function deliverWebhooks(db, workspaceId, event, payload) {
  const { data: hooks } = await db.from("webhooks").select("*").eq("workspace_id", workspaceId).eq("active", true).contains("events", [event]);
  for (const hook of hooks ?? []) {
    try {
      const body = JSON.stringify({ event, workspace_id: workspaceId, payload, ts: Date.now() });
      const sig = await hmacHex(hook.secret, body);
      await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Socivo-Signature": sig },
        body
      });
    } catch (err) {
      console.error(`webhook delivery failed (${hook.url}):`, err);
    }
  }
}
async function dailyDigests(db) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const hour = (/* @__PURE__ */ new Date()).getUTCHours();
  const { data: due } = await db.from("notification_settings").select("*").eq("digest_hour", hour).or(`last_digest_date.is.null,last_digest_date.lt.${today}`).limit(5);
  let sent = 0;
  for (const s of due ?? []) {
    try {
      const since = new Date(Date.now() - 864e5).toISOString();
      const [{ count: sentCount }, { data: replies }, { count: bounces }, { count: drafts }, { data: mbs }, { data: digestItems }] = await Promise.all([
        db.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", s.workspace_id).eq("direction", "outbound").eq("is_seed", false).eq("is_internal", false).gte("occurred_at", since),
        db.from("messages").select("category").eq("workspace_id", s.workspace_id).eq("direction", "inbound").not("category", "is", null).gte("occurred_at", since),
        db.from("events").select("id", { count: "exact", head: true }).eq("workspace_id", s.workspace_id).eq("type", "bounce").gte("created_at", since),
        db.from("drafts").select("id, campaign_leads!inner(campaigns!inner(workspace_id))", { count: "exact", head: true }).eq("status", "pending").eq("campaign_leads.campaigns.workspace_id", s.workspace_id),
        db.from("mailboxes").select("email, status, health_score, sent_today").eq("workspace_id", s.workspace_id),
        db.from("notification_queue").select("event, payload").eq("workspace_id", s.workspace_id).eq("status", "digest").limit(50)
      ]);
      const byCategory = {};
      for (const r of replies ?? []) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      const lines = [
        `Socivo daily digest`,
        ``,
        `Sent (24h): ${sentCount ?? 0}`,
        `Replies by category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
        `Bounces: ${bounces ?? 0}`,
        `Drafts awaiting approval: ${drafts ?? 0}`,
        ``,
        `Mailboxes:`,
        ...(mbs ?? []).map((m) => `  ${m.email} \u2014 ${m.status}, health ${m.health_score}, sent today ${m.sent_today}`),
        ``,
        ...(digestItems == null ? void 0 : digestItems.length) ? [`Other events:`, ...digestItems.map((d) => `  ${d.event}: ${JSON.stringify(d.payload)}`)] : []
      ];
      await dispatchNotification(db, { workspace_id: s.workspace_id, event: "daily_digest", payload: { text: lines.join("\n") } }, s);
      await db.from("notification_queue").update({ status: "sent" }).eq("workspace_id", s.workspace_id).eq("status", "digest");
      await db.from("notification_settings").update({ last_digest_date: today }).eq("workspace_id", s.workspace_id);
      sent++;
    } catch (err) {
      console.error(`digest failed for workspace ${s.workspace_id}:`, err);
    }
  }
  return { digests: sent };
}
