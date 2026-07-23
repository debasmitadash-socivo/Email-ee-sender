import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Route-handler guard: authenticated user + membership of the given
 * workspace. Uses the RLS-scoped client, so a non-member simply sees no row.
 */
export async function requireMember(
  workspaceId: string
): Promise<{ userId: string; role: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { userId: user.id, role: data.role } : null;
}

/** Access levels in ascending order of power. */
const ROLE_RANK: Record<string, number> = {
  l1_basic: 1,
  l2_limited: 2,
  l3_full: 3,
  admin: 4,
  // legacy names (pre-0010 rows) map to their new equivalents
  viewer: 1,
  member: 2,
};

/**
 * Membership + minimum access level. Returns null when the caller is not a
 * member or their role ranks below `min`.
 */
export async function requireRole(
  workspaceId: string,
  min: "l1_basic" | "l2_limited" | "l3_full" | "admin"
): Promise<{ userId: string; role: string } | null> {
  const m = await requireMember(workspaceId);
  if (!m) return null;
  return (ROLE_RANK[m.role] ?? 0) >= ROLE_RANK[min] ? m : null;
}
