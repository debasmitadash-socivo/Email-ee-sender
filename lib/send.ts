import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Mailbox } from "@/lib/types";
import { getAccessToken } from "@/lib/mailbox-token";
import { buildMime, base64UrlEncode, generateMessageId } from "@/lib/mime";
import { gmailSend } from "@/lib/gmail";
import { graphSendMail, graphReply } from "@/lib/graph";

export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  listUnsubscribe?: string;
  // threading (follow-ups)
  thread?: {
    providerThreadId?: string; // gmail threadId
    providerMessageId?: string; // graph original message id
    internetMessageId?: string; // step-1 Message-ID
  };
}

export interface SendResult {
  providerMessageId: string | null;
  providerThreadId: string | null;
  internetMessageId: string | null;
}

/** Provider-agnostic send with correct threading on both providers (§8). */
export async function sendFromMailbox(
  admin: SupabaseClient,
  mailbox: Mailbox,
  args: SendArgs
): Promise<SendResult> {
  const accessToken = await getAccessToken(admin, mailbox);

  if (mailbox.provider === "google") {
    const domain = mailbox.email.split("@")[1] ?? "localhost";
    const messageId = generateMessageId(domain);
    const raw = buildMime({
      from: { name: mailbox.display_name ?? undefined, email: mailbox.email },
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      messageId,
      inReplyTo: args.thread?.internetMessageId,
      references: args.thread?.internetMessageId ? [args.thread.internetMessageId] : undefined,
      listUnsubscribe: args.listUnsubscribe,
    });
    const res = await gmailSend(accessToken, base64UrlEncode(raw), args.thread?.providerThreadId);
    return { providerMessageId: res.id, providerThreadId: res.threadId, internetMessageId: messageId };
  }

  // Microsoft Graph
  if (args.thread?.providerMessageId) {
    const res = await graphReply(accessToken, args.thread.providerMessageId, {
      to: args.to,
      text: args.text,
      html: args.html,
    });
    return {
      providerMessageId: res.id,
      providerThreadId: res.conversationId ?? null,
      internetMessageId: res.internetMessageId ?? null,
    };
  }
  const res = await graphSendMail(accessToken, {
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });
  return {
    providerMessageId: res?.id ?? null,
    providerThreadId: res?.conversationId ?? null,
    internetMessageId: res?.internetMessageId ?? null,
  };
}
