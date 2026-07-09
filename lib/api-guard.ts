import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Route-handler guard: authenticated user + membership of the given
 * workspace. Uses the RLS-scoped client, so a non-member simply sees no row.
 */
export async function requireMember(workspaceId: string): Promise<{ userId: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { userId: user.id } : null;
}
