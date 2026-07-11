// Template rendering: {{vars}}, spintax, AI slot injection, footer +
// unsubscribe assembly. Pure functions; a Deno twin lives in
// supabase/functions/_shared/render.ts — keep in sync.
import type { Lead, KnowledgeProfile } from "@/lib/types";

/** Resolve {a|b|c} spintax, deterministic when rand provided. */
export function spin(text: string, rand: () => number = Math.random): string {
  let out = text;
  // innermost-first so nesting works
  for (let i = 0; i < 20; i++) {
    const m = out.match(/\{([^{}]*\|[^{}]*)\}/);
    if (!m) break;
    const options = m[1].split("|");
    out = out.slice(0, m.index!) + options[Math.floor(rand() * options.length)] + out.slice(m.index! + m[0].length);
  }
  return out;
}

export function leadVars(lead: Lead): Record<string, string> {
  return {
    email: lead.email,
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

/** Substitute {{var}} placeholders; AI slots ({{ai_*}}) come from `slots`. */
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

/**
 * Compliance assembly (§14): footer identity in every email (required for cold email),
 * US postal address when the campaign targets the US (CAN-SPAM requirement).
 * Unsubscribe is handled via email List-Unsubscribe header (shows discreet chip in email clients).
 */
export function assembleBody(args: {
  body: string;
  profile: KnowledgeProfile;
  unsubscribeUrl: string;
  usTargeting?: boolean;
  signatureHtml?: string | null;
  plainText: boolean;
}): { text: string; html?: string } {
  const footerLines: string[] = [];
  if (args.profile.footer_identity) footerLines.push(args.profile.footer_identity);
  if (args.usTargeting && args.profile.postal_address) footerLines.push(args.profile.postal_address);
  // Note: unsubscribe is conveyed via email header (List-Unsubscribe), not body text
  // This keeps cold emails professional and removes newsletter-style "Don't want to hear from me?" language

  const text = footerLines.length ? `${args.body.trim()}\n\n--\n${footerLines.join("\n")}` : args.body.trim();
  if (args.plainText) return { text };

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const htmlBody = esc(args.body.trim()).replace(/\n/g, "<br>");
  const htmlFooter = footerLines.map((l) => esc(l).replace(/\n/g, "<br>")).join("<br>");
  const html = `<div>${htmlBody}${args.signatureHtml ? `<br><br>${args.signatureHtml}` : ""}${
    htmlFooter ? `<br><br><span style="color:#6B6B76;font-size:12px">--<br>${htmlFooter}</span>` : ""
  }</div>`;
  return { text, html };
}
