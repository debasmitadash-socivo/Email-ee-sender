// Per-email lint (Deliverability Guard §5 of plan / §10 of brief):
// spam words, banned phrases, max 2 links, no attachments (we never attach),
// subject length warning. Pure function — used by the writer QA gates,
// the campaign Review tab and mirrored in the edge research function.
import { spamWords, bannedPhrases } from "@/config/spam-words";

export interface LintIssue {
  level: "error" | "warn";
  rule: string;
  detail: string;
}

const LINK_RE = /https?:\/\/[^\s)>\]"']+/gi;

export function lintEmail(subject: string, body: string, extraBanned: string[] = []): LintIssue[] {
  const issues: LintIssue[] = [];
  const haystack = `${subject}\n${body}`.toLowerCase();

  for (const w of spamWords) {
    if (haystack.includes(w.toLowerCase())) {
      issues.push({ level: "warn", rule: "spam_word", detail: `Contains spam-trigger phrase: "${w}"` });
    }
  }
  for (const p of [...bannedPhrases, ...extraBanned]) {
    if (p && haystack.includes(p.toLowerCase())) {
      issues.push({ level: "error", rule: "banned_phrase", detail: `Contains banned phrase: "${p}"` });
    }
  }

  const links = body.match(LINK_RE) ?? [];
  if (links.length > 2) {
    issues.push({ level: "error", rule: "max_links", detail: `${links.length} links found (max 2)` });
  }

  if (subject.length > 60) {
    issues.push({ level: "warn", rule: "subject_length", detail: `Subject is ${subject.length} chars (aim ≤ 60)` });
  }
  if (!subject.trim()) {
    issues.push({ level: "error", rule: "subject_empty", detail: "Subject is empty" });
  }

  const wordCount = body.trim().split(/\s+/).length;
  if (wordCount > 180) {
    issues.push({ level: "warn", rule: "body_length", detail: `Body is ${wordCount} words (aim ≤ 150)` });
  }
  return issues;
}
