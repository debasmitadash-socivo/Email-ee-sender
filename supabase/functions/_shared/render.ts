// Deno twin of /lib/render.ts — keep in sync.

export function spin(text: string): string {
  let out = text;
  for (let i = 0; i < 20; i++) {
    const m = out.match(/\{([^{}]*\|[^{}]*)\}/);
    if (!m) break;
    const options = m[1].split("|");
    out =
      out.slice(0, m.index!) +
      options[Math.floor(Math.random() * options.length)] +
      out.slice(m.index! + m[0].length);
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export function leadVars(lead: any): Record<string, string> {
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
    ),
  };
}

export function renderVars(
  text: string,
  vars: Record<string, string>,
  slots: Record<string, string> = {}
): { rendered: string; missing: string[] } {
  const missing: string[] = [];
  const rendered = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    if (name.startsWith("ai_")) {
      if (slots[name] !== undefined) return slots[name];
      missing.push(name);
      return "";
    }
    if (vars[name] !== undefined && vars[name] !== "") return vars[name];
    missing.push(name);
    return "";
  });
  return { rendered, missing };
}

export interface AssembleArgs {
  body: string;
  footerIdentity?: string;
  postalAddress?: string;
  unsubscribeUrl: string;
  usTargeting?: boolean;
  signatureHtml?: string | null;
  plainText: boolean;
  trackingPixelUrl?: string; // only when track_opens && !plainText
  clickWrapper?: (url: string) => string; // only when track_clicks && !plainText
}

export function assembleBody(args: AssembleArgs): { text: string; html?: string } {
  const footerLines: string[] = [];
  if (args.footerIdentity) footerLines.push(args.footerIdentity);
  if (args.usTargeting && args.postalAddress) footerLines.push(args.postalAddress);
  footerLines.push(`Don't want to hear from me again? Unsubscribe: ${args.unsubscribeUrl}`);

  const text = `${args.body.trim()}\n\n--\n${footerLines.join("\n")}`;
  if (args.plainText) return { text }; // no pixel in plain-text mode (per lint rules)

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let htmlBody = esc(args.body.trim()).replace(/\n/g, "<br>");
  if (args.clickWrapper) {
    htmlBody = htmlBody.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
      const wrapped = args.clickWrapper!(url);
      return `<a href="${wrapped}">${url}</a>`;
    });
  }
  const htmlFooter = footerLines
    .map((l) =>
      l.includes(args.unsubscribeUrl)
        ? `Don't want to hear from me again? <a href="${args.unsubscribeUrl}">Unsubscribe</a>`
        : esc(l).replace(/\n/g, "<br>")
    )
    .join("<br>");
  const pixel = args.trackingPixelUrl
    ? `<img src="${args.trackingPixelUrl}" width="1" height="1" alt="" style="display:none">`
    : "";
  const html = `<div>${htmlBody}${args.signatureHtml ? `<br><br>${args.signatureHtml}` : ""}<br><br><span style="color:#6B6B76;font-size:12px">--<br>${htmlFooter}</span>${pixel}</div>`;
  return { text, html };
}
