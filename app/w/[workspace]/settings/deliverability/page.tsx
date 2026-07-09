import { requireWorkspace } from "@/lib/workspace";
import { PageHeader, Card } from "@/components/ui";

export default async function DeliverabilityPage({ params }: { params: { workspace: string } }) {
  await requireWorkspace(params.workspace);
  return (
    <div>
      <PageHeader title="Deliverability" />
      <div className="space-y-6 max-w-2xl text-sm">
        <Card>
          <h2 className="text-sm font-semibold mb-2">What the Guard enforces automatically</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>Launch gate: live SPF / DKIM / DMARC checks per sending domain (blocking).</li>
            <li>Warm-up ramp per mailbox: wk1 8/day → wk2 15 → wk3 25 → your cap (hard max 50).</li>
            <li>2–9 minute jitter between sends; sends only inside the campaign window.</li>
            <li>Hard compliance hours: nothing sends before 06:00 or after 21:00 lead-local, ever.</li>
            <li>Max 5 emails/day into any single recipient domain per campaign (configurable).</li>
            <li>Circuit breakers: campaign pauses at &gt;3% bounce rate over the trailing 50 sends; a mailbox pauses after 3 consecutive failures or an auth error. Every trip notifies you.</li>
            <li>Unsubscribe link + footer identity in every email; suppression re-checked at send time.</li>
          </ul>
          <p className="text-muted mt-3">
            One honest note: no software can guarantee inbox placement. The Guard enforces every controllable
            lever; the rest is list quality and copy.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold mb-2">Google Postmaster Tools (free — set up once per domain)</h2>
          <ol className="list-decimal pl-5 space-y-1 text-muted">
            <li>
              Go to{" "}
              <a href="https://postmaster.google.com" target="_blank" rel="noreferrer" className="text-secondary hover:underline">
                postmaster.google.com
              </a>{" "}
              and sign in with any Google account.
            </li>
            <li>Click “+” and add each domain you send from (e.g. socivo.co.uk).</li>
            <li>Verify via the DNS TXT record Google gives you (add it wherever your DNS lives).</li>
            <li>After ~a week of volume you'll see domain reputation, spam-rate and delivery errors — Google's own data.</li>
            <li>Watch the spam-rate graph: stay under 0.1%; above 0.3% Gmail actively filters you.</li>
          </ol>
          <p className="text-muted mt-3">
            Bookmark your dashboard here:{" "}
            <a href="https://postmaster.google.com/managedomains" target="_blank" rel="noreferrer" className="text-secondary hover:underline">
              postmaster.google.com/managedomains
            </a>
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold mb-2">Seed testing</h2>
          <p className="text-muted">
            Add your own test Gmail/Outlook addresses on the Knowledge page (seed inboxes), then use the
            “Seed test” button on any campaign to send the rendered sequence to yourself before going live —
            check which folder it lands in. Seed sends never count in analytics.
          </p>
        </Card>
      </div>
    </div>
  );
}
