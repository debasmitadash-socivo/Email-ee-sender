import "server-only";
import { promises as dns } from "node:dns";
import type { MailboxProvider } from "@/lib/types";

export interface DnsCheckResult {
  domain: string;
  spf: { pass: boolean; record?: string; fix: string };
  dkim: { pass: boolean; selector?: string; fix: string };
  dmarc: { pass: boolean; record?: string; fix: string };
}

const SPF_INCLUDES: Record<MailboxProvider, string> = {
  google: "_spf.google.com",
  microsoft: "spf.protection.outlook.com",
};

const DKIM_SELECTORS: Record<MailboxProvider, string[]> = {
  google: ["google"],
  microsoft: ["selector1", "selector2"],
};

async function txt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

/** Live SPF / DKIM / DMARC check with fix-it copy per failure (§10 launch gate). */
export async function checkDns(domain: string, provider: MailboxProvider): Promise<DnsCheckResult> {
  const [spfRecords, dmarcRecords] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);

  const spfRecord = spfRecords.find((r) => r.toLowerCase().startsWith("v=spf1"));
  const spfPass = !!spfRecord && spfRecord.includes(SPF_INCLUDES[provider]);

  let dkimPass = false;
  let dkimSelector: string | undefined;
  for (const sel of DKIM_SELECTORS[provider]) {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    // CNAME-based DKIM (Microsoft) won't resolve as TXT directly; try resolveCname too
    if (recs.some((r) => r.includes("v=DKIM1") || r.includes("p="))) {
      dkimPass = true;
      dkimSelector = sel;
      break;
    }
    try {
      const cname = await dns.resolveCname(`${sel}._domainkey.${domain}`);
      if (cname.length) {
        dkimPass = true;
        dkimSelector = sel;
        break;
      }
    } catch {
      /* keep trying */
    }
  }

  const dmarcRecord = dmarcRecords.find((r) => r.toLowerCase().startsWith("v=dmarc1"));

  return {
    domain,
    spf: {
      pass: spfPass,
      record: spfRecord,
      fix: spfPass
        ? ""
        : `Add a TXT record on ${domain}: "v=spf1 include:${SPF_INCLUDES[provider]} ~all". If an SPF record already exists, add "include:${SPF_INCLUDES[provider]}" to it — never create a second v=spf1 record.`,
    },
    dkim: {
      pass: dkimPass,
      selector: dkimSelector,
      fix: dkimPass
        ? ""
        : provider === "google"
          ? `Enable DKIM in Google Admin (Apps → Google Workspace → Gmail → Authenticate email), then add the generated TXT record at google._domainkey.${domain} and click "Start authentication".`
          : `In Microsoft 365 Defender (Email authentication settings → DKIM), enable DKIM for ${domain} and add the two CNAME records (selector1/selector2._domainkey.${domain}) it shows you.`,
    },
    dmarc: {
      pass: !!dmarcRecord,
      record: dmarcRecord,
      fix: dmarcRecord
        ? ""
        : `Add a TXT record at _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}". Start with p=none (monitor), tighten to quarantine once reports look clean.`,
    },
  };
}
