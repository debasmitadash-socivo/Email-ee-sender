import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Service-role client for edge functions (bypasses RLS by design, §1.9). */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Queue a notification event; the tick's flush step dispatches it. */
export async function queueNotification(
  db: SupabaseClient,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
) {
  await db.from("notification_queue").insert({ workspace_id: workspaceId, event, payload });
}

/** Once-per-day alert dedupe via alert_log. Returns true if this is the first time today. */
export async function onceToday(db: SupabaseClient, key: string): Promise<boolean> {
  const { error } = await db.from("alert_log").insert({ key, day: new Date().toISOString().slice(0, 10) });
  return !error; // conflict → already alerted today
}
