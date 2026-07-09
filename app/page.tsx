import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Root: send the user to their first workspace, or to workspace creation.
export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .limit(1);

  const slug = (memberships?.[0] as { workspaces?: { slug?: string } } | undefined)?.workspaces?.slug;
  if (slug) redirect(`/w/${slug}`);
  redirect("/new-workspace");
}
