// Minimal RFC 2822 message builder for the Gmail API raw-send path.

export interface MimeInput {
  from: { name?: string; email: string };
  to: string;
  subject: string;
  text: string;
  html?: string; // omitted in plain-text mode
  messageId: string; // full <id@domain> form
  inReplyTo?: string;
  references?: string[];
  listUnsubscribe?: string; // URL
}

function encodeHeaderWord(s: string): string {
  // encode non-ASCII per RFC 2047
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}

export function generateMessageId(domain: string): string {
  const rand =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `<${rand}@${domain}>`;
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
    // One-Click POST is only valid for https endpoints (RFC 8058), not mailto:
    if (input.listUnsubscribe.startsWith("http")) {
      headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    }
  }

  let body: string;
  if (input.html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(input.text).toString("base64"),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(input.html).toString("base64"),
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    body = Buffer.from(input.text).toString("base64");
  }

  return headers.join("\r\n") + "\r\n\r\n" + body;
}

export function base64UrlEncode(s: string): string {
  return Buffer.from(s).toString("base64url");
}
