// Gmail API client — HTTPS only, no SMTP/IMAP (build brief §1.2, §8).

const GMAIL = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function gmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch(`${GMAIL}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile failed: ${res.status}`);
  return res.json();
}

/**
 * Send a raw RFC 2822 message. For follow-ups pass threadId so Gmail threads
 * it; In-Reply-To/References must already be in the raw headers.
 */
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
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function gmailHistoryList(
  accessToken: string,
  startHistoryId: string
): Promise<{ history?: { messagesAdded?: { message: { id: string; threadId: string } }[] }[]; historyId?: string }> {
  const url = new URL(`${GMAIL}/users/me/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) throw Object.assign(new Error("history expired"), { code: "HISTORY_EXPIRED" });
  if (!res.ok) throw new Error(`Gmail history failed: ${res.status}`);
  return res.json();
}

export async function gmailListRecent(
  accessToken: string
): Promise<{ messages?: { id: string; threadId: string }[] }> {
  const url = new URL(`${GMAIL}/users/me/messages`);
  url.searchParams.set("q", "in:inbox newer_than:2d");
  url.searchParams.set("maxResults", "25");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
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

export async function gmailGetMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL}/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail get message failed: ${res.status}`);
  return res.json();
}

export function gmailHeader(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

export function gmailPlainText(msg: GmailMessage): string {
  function walk(p?: GmailMessage["payload"]): string | null {
    if (!p) return null;
    if (p.mimeType === "text/plain" && p.body?.data)
      return Buffer.from(p.body.data, "base64url").toString();
    for (const part of p.parts ?? []) {
      const found = walk(part as GmailMessage["payload"]);
      if (found) return found;
    }
    return null;
  }
  return walk(msg.payload) ?? msg.snippet ?? "";
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "openid",
      "email",
    ].join(" ")
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // force refresh_token issuance
  url.searchParams.set("state", state);
  return url.toString();
}
