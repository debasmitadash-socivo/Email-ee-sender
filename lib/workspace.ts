import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import type { Workspace } from "@/lib/types";

/** Resolve the current workspace by slug; RLS guarantees membership. */
export async function requireWorkspace(slug: string): Promise<{
  workspace: Workspace;
  userId: string;
  role: string;
  allWorkspaces: Workspace[];
}> {
  const supabase = createClient();
  // auth check and workspace lookup don't depend on each other — run them in
  // parallel instead of serially (this runs on every page load via the
  // workspace layout, so cutting round trips here matters everywhere).
  const [
    {
      data: { user },
    },
    { data: workspace },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("workspaces").select("*").eq("slug", slug).maybeSingle(),
  ]);
  if (!user) redirect("/login");
  if (!workspace) notFound();

  const [{ data: member }, { data: all }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("workspaces").select("*").order("name"),
  ]);

  return {
    workspace: workspace as Workspace,
    userId: user.id,
    role: member?.role ?? "viewer",
    allWorkspaces: (all ?? []) as Workspace[],
  };
}
