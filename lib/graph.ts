// Microsoft Graph client — HTTPS only. Threading uses createReply →
// PATCH → send (Graph rejects non-x- custom internet headers on sendMail;
// do not fight this — build brief §8).

const GRAPH = "https://graph.microsoft.com/v1.0";

function tokenUrl(): string {
  return `https://login.microsoftonline.com/${process.env.MS_TENANT || "common"}/oauth2/v2.0/token`;
}

export const MS_SCOPES = "offline_access Mail.Send Mail.ReadWrite User.Read";

export interface MsTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeMsCode(code: string, redirectUri: string): Promise<MsTokens> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: MS_SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`MS token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshMsToken(refreshToken: string): Promise<MsTokens> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      grant_type: "refresh_token",
      scope: MS_SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`MS token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function graphMe(accessToken: string): Promise<{ mail?: string; userPrincipalName: string; displayName?: string }> {
  const res = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Graph /me failed: ${res.status}`);
  return res.json();
}

/** Step-1 send. Returns the sent message's id + internetMessageId by locating it in Sent Items. */
export async function graphSendMail(
  accessToken: string,
  args: { to: string; subject: string; text: string; html?: string }
): Promise<{ id: string; conversationId: string; internetMessageId: string } | null> {
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
  if (!res.ok) throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);

  // sendMail returns 202 with no body; fetch the sent message for ids
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
  const match = data.value.find(
    (m) =>
      m.subject === args.subject &&
      m.toRecipients.some((r) => r.emailAddress.address.toLowerCase() === args.to.toLowerCase())
  );
  return match ?? null;
}

/** Follow-up: createReply on the original → PATCH body/recipients → send. */
export async function graphReply(
  accessToken: string,
  originalMessageId: string,
  args: { to: string; text: string; html?: string }
): Promise<{ id: string; conversationId?: string; internetMessageId?: string }> {
  const create = await fetch(`${GRAPH}/me/messages/${originalMessageId}/createReply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!create.ok) throw new Error(`Graph createReply failed: ${create.status} ${await create.text()}`);
  const draft = (await create.json()) as { id: string };

  const patch = await fetch(`${GRAPH}/me/messages/${draft.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      body: { contentType: args.html ? "HTML" : "Text", content: args.html ?? args.text },
      toRecipients: [{ emailAddress: { address: args.to } }],
    }),
  });
  if (!patch.ok) throw new Error(`Graph draft patch failed: ${patch.status} ${await patch.text()}`);
  const patched = (await patch.json()) as { id: string; conversationId?: string; internetMessageId?: string };

  const send = await fetch(`${GRAPH}/me/messages/${draft.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!send.ok) throw new Error(`Graph draft send failed: ${send.status} ${await send.text()}`);
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
  internetMessageHeaders?: { name: string; value: string }[];
}

/** Delta query over the inbox; deltaLink persisted as poll_cursor. */
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
    if (!res.ok) throw new Error(`Graph delta failed: ${res.status}`);
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
    `${GRAPH}/me/messages/${id}?$select=id,conversationId,internetMessageId,subject,bodyPreview,body,from,receivedDateTime,internetMessageHeaders`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Graph get message failed: ${res.status}`);
  return res.json();
}

export function msAuthUrl(redirectUri: string, state: string): string {
  const url = new URL(
    `https://login.microsoftonline.com/${process.env.MS_TENANT || "common"}/oauth2/v2.0/authorize`
  );
  url.searchParams.set("client_id", process.env.MS_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", MS_SCOPES);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("state", state);
  return url.toString();
}
