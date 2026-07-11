// Deno twins of the Gmail/Graph clients, MIME builder and runChain.
// Keep behaviour in sync with /lib/{gmail,graph,mime}.ts and
// /lib/providers/run-chain.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chains, type Capability } from "./config.ts";
import { decrypt } from "./crypto.ts";

// ── MIME ─────────────────────────────────────────────────────────────────────
function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64UrlEncode(s: string): string {
  return b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeHeaderWord(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${b64(s)}?=`;
}

export function generateMessageId(domain: string): string {
  const rand =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `<${rand}@${domain}>`;
}

export interface MimeInput {
  from: { name?: string; email: string };
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  listUnsubscribe?: string;
}

export function buildMime(input: MimeInput): string {
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const fromHeader = input.from.name
    ? `${encodeHeaderWord(input.from.name)} <${input.from.email}>`
    : input.from.email;
  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Message-ID: ${input.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length) headers.push(`References: ${input.references.join(" ")}`);
  if (input.listUnsubscribe) {
    headers.push(`List-Unsubscribe: <${input.listUnsubscribe}>`);
    headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  let body: string;
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
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    body = b64(input.text);
  }
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// ── OAuth token refresh ──────────────────────────────────────────────────────
export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function refreshGoogleToken(refreshToken: string): Promise<Tokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google refresh ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function refreshMsToken(refreshToken: string): Promise<Tokens> {
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
        scope: "offline_access Mail.Send Mail.ReadWrite User.Read",
      }),
    }
  );
  if (!res.ok) throw new Error(`ms refresh ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Gmail ────────────────────────────────────────────────────────────────────
const GMAIL = "https://gmail.googleapis.com/gmail/v1";

export async function gmailSend(
  accessToken: string,
  rawBase64Url: string,
  threadId?: string
): Promise<{ id: string; threadId: string }> {
  const res = await fetch(`${GMAIL}/users/me/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(threadId ? { raw: rawBase64Url, threadId } : { raw: rawBase64Url }),
  });
  if (!res.ok) throw new Error(`gmail send ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface GmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  snippet?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string };
    parts?: { mimeType?: string; body?: { data?: string }; parts?: GmailMessage["payload"][] }[];
  };
  internalDate?: string;
}

export async function gmailProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string }> {
  const res = await fetch(`${GMAIL}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`gmail profile ${res.status}`);
  return res.json();
}

export async function gmailHistoryList(accessToken: string, startHistoryId: string) {
  const url = new URL(`${GMAIL}/users/me/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) throw Object.assign(new Error("history expired"), { code: "HISTORY_EXPIRED" });
  if (!res.ok) throw new Error(`gmail history ${res.status}`);
  return res.json() as Promise<{
    history?: { messagesAdded?: { message: { id: string } }[] }[];
    historyId?: string;
  }>;
}

export async function gmailListRecent(accessToken: string) {
  const url = new URL(`${GMAIL}/users/me/messages`);
  url.searchParams.set("q", "in:inbox newer_than:2d");
  url.searchParams.set("maxResults", "25");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`gmail list ${res.status}`);
  return res.json() as Promise<{ messages?: { id: string }[] }>;
}

export async function gmailGetMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL}/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`gmail get ${res.status}`);
  return res.json();
}

export function gmailHeader(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

export function gmailPlainText(msg: GmailMessage): string {
  function decode(data: string): string {
    const pad = data.length % 4 === 0 ? "" : "=".repeat(4 - (data.length % 4));
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function walk(p?: GmailMessage["payload"]): string | null {
    if (!p) return null;
    if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
    for (const part of p.parts ?? []) {
      const found = walk(part as GmailMessage["payload"]);
      if (found) return found;
    }
    return null;
  }
  return walk(msg.payload) ?? msg.snippet ?? "";
}

// ── Microsoft Graph ─────────────────────────────────────────────────────────
const GRAPH = "https://graph.microsoft.com/v1.0";

export async function graphSendMail(
  accessToken: string,
  args: { to: string; subject: string; text: string; html?: string }
) {
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: args.subject,
        body: { contentType: args.html ? "HTML" : "Text", content: args.html ?? args.text },
        toRecipients: [{ emailAddress: { address: args.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`graph sendMail ${res.status}: ${await res.text()}`);

  const q = new URL(`${GRAPH}/me/mailFolders/SentItems/messages`);
  q.searchParams.set("$top", "5");
  q.searchParams.set("$orderby", "sentDateTime desc");
  q.searchParams.set("$select", "id,conversationId,internetMessageId,toRecipients,subject");
  const sent = await fetch(q, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!sent.ok) return null;
  const data = (await sent.json()) as {
    value: {
      id: string;
      conversationId: string;
      internetMessageId: string;
      subject: string;
      toRecipients: { emailAddress: { address: string } }[];
    }[];
  };
  return (
    data.value.find(
      (m) =>
        m.subject === args.subject &&
        m.toRecipients.some((r) => r.emailAddress.address.toLowerCase() === args.to.toLowerCase())
    ) ?? null
  );
}

export async function graphReply(
  accessToken: string,
  originalMessageId: string,
  args: { to: string; text: string; html?: string }
) {
  const create = await fetch(`${GRAPH}/me/messages/${originalMessageId}/createReply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!create.ok) throw new Error(`graph createReply ${create.status}: ${await create.text()}`);
  const draft = (await create.json()) as { id: string };

  const patch = await fetch(`${GRAPH}/me/messages/${draft.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      body: { contentType: args.html ? "HTML" : "Text", content: args.html ?? args.text },
      toRecipients: [{ emailAddress: { address: args.to } }],
    }),
  });
  if (!patch.ok) throw new Error(`graph patch ${patch.status}: ${await patch.text()}`);
  const patched = (await patch.json()) as { id: string; conversationId?: string; internetMessageId?: string };

  const send = await fetch(`${GRAPH}/me/messages/${draft.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!send.ok) throw new Error(`graph send ${send.status}: ${await send.text()}`);
  return patched;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  from?: { emailAddress: { address: string; name?: string } };
  receivedDateTime?: string;
}

export async function graphInboxDelta(
  accessToken: string,
  deltaLink?: string
): Promise<{ messages: GraphMessage[]; deltaLink?: string }> {
  let url =
    deltaLink ??
    `${GRAPH}/me/mailFolders/Inbox/messages/delta?$select=id,conversationId,internetMessageId,subject,bodyPreview,from,receivedDateTime`;
  const messages: GraphMessage[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) throw Object.assign(new Error("delta expired"), { code: "DELTA_EXPIRED" });
    if (!res.ok) throw new Error(`graph delta ${res.status}`);
    const data = (await res.json()) as {
      value: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    messages.push(...data.value);
    if (data["@odata.deltaLink"]) return { messages, deltaLink: data["@odata.deltaLink"] };
    if (!data["@odata.nextLink"]) return { messages };
    url = data["@odata.nextLink"];
  }
  return { messages };
}

export async function graphGetMessage(accessToken: string, id: string): Promise<GraphMessage> {
  const res = await fetch(
    `${GRAPH}/me/messages/${id}?$select=id,conversationId,internetMessageId,subject,bodyPreview,body,from,receivedDateTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`graph get ${res.status}`);
  return res.json();
}

// ── runChain (Deno twin) ────────────────────────────────────────────────────
export class ChainExhaustedError extends Error {
  constructor(public capability: Capability) {
    super(`Provider chain exhausted for capability: ${capability}`);
  }
}

async function getUsage(db: SupabaseClient, provider: string, capability: string) {
  const { data } = await db
    .from("provider_usage")
    .select("used, failed")
    .eq("provider", provider)
    .eq("capability", capability)
    .eq("day", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  return data ?? { used: 0, failed: 0 };
}

async function bumpUsage(db: SupabaseClient, provider: string, capability: string, field: "used" | "failed") {
  const day = new Date().toISOString().slice(0, 10);
  const current = await getUsage(db, provider, capability);
  await db.from("provider_usage").upsert(
    {
      provider,
      capability,
      day,
      used: current.used + (field === "used" ? 1 : 0),
      failed: current.failed + (field === "failed" ? 1 : 0),
    },
    { onConflict: "provider,capability,day" }
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function isQuotaError(err: unknown): boolean {
  return /\b(429|402|quota|rate.?limit|resource.?exhausted|too many requests|insufficient|limit reached|exhaust)\b/i.test(
    String(err)
  );
}

interface Candidate {
  key: string;
  source: "db" | "env";
  id?: string;
}

async function candidatesFor(db: SupabaseClient, provider: string, envKey?: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const { data: rows } = await db
    .from("provider_keys")
    .select("id, key_enc, exhausted_date, priority")
    .eq("provider", provider)
    .eq("active", true)
    .order("priority");
  for (const r of rows ?? []) {
    if (r.exhausted_date === today()) continue;
    try {
      out.push({ key: await decrypt(r.key_enc), source: "db", id: r.id });
    } catch {
      /* skip undecryptable */
    }
  }
  if (envKey) out.push({ key: envKey, source: "env" });
  return out;
}

async function markExhausted(db: SupabaseClient, provider: string, cand: Candidate) {
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
        payload: { provider, note: `${provider} hit its free daily limit — rotated to the next available key/provider.` },
      });
    }
  }
}

export async function runChain<T>(
  db: SupabaseClient,
  capability: Capability,
  task: (provider: string, apiKey: string) => Promise<T>
): Promise<{ result: T; provider: string }> {
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

// ── AI call helper (shared by brief/writer/classifier) ──────────────────────
import { aiModels } from "./config.ts";

/** Call an AI provider with a prompt, expect raw text back. */
export async function aiComplete(provider: string, apiKey: string, system: string, user: string): Promise<string> {
  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiModels.gemini}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
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
        temperature: 0.2,
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
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModels.anthropic,
        max_tokens: 1024,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }
  throw new Error(`unknown AI provider ${provider}`);
}

/** Parse strict JSON out of an AI response (tolerates code fences). Retry-once is the caller's job. */
export function parseJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}
