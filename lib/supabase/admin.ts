import "server-only";
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

// Service-role client. Bypasses RLS — server-only code paths that must cross
// workspace boundaries (OAuth callbacks, tracking endpoints, REST API).
// The web app's normal data access NEVER uses this (build brief §1.9).
export function createAdminClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
