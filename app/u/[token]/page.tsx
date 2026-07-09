import { verifyToken } from "@/lib/crypto";
import { UnsubscribeConfirm } from "./confirm";

// Unsubscribe landing page. Confirms, writes suppression (global), stops sequences.
export default async function UnsubscribePage({ params }: { params: { token: string } }) {
  const payload = await verifyToken(params.token);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 max-w-md w-full text-center">
        {payload?.e ? (
          <UnsubscribeConfirm token={params.token} email={payload.e} />
        ) : (
          <p className="text-sm text-muted">This unsubscribe link is invalid or has expired.</p>
        )}
      </div>
    </div>
  );
}
