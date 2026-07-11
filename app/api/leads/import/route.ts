import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

interface ImportRow {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  linkedin_url?: string;
  timezone?: string;
  custom?: Record<string, unknown>;
}

// CSV import: dedupe against the workspace (unique(workspace_id,email) +
// ignoreDuplicates upsert). RLS-scoped client — inserts fail for non-members.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    workspace_id: string;
    list_id?: string;
    new_list_name?: string;
    tags?: string[];
    rows: ImportRow[];
  };
  const importTags = (body.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!body.workspace_id || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "workspace_id and rows required" }, { status: 400 });
  }
  if (!(await requireMember(body.workspace_id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = createClient();

  let listId = body.list_id ?? null;
  if (!listId && body.new_list_name) {
    const { data: list, error } = await supabase
      .from("lead_lists")
      .insert({ workspace_id: body.workspace_id, name: body.new_list_name })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    listId = list.id;
  }

  const seen = new Set<string>();
  const rows = body.rows
    .map((r) => ({ ...r, email: r.email?.trim().toLowerCase() }))
    .filter((r) => {
      if (!r.email || !r.email.includes("@") || seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    })
    .slice(0, 5000)
    .map((r) => ({
      workspace_id: body.workspace_id,
      list_id: listId,
      email: r.email,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      company: r.company || null,
      domain: r.email.split("@")[1],
      title: r.title || null,
      linkedin_url: r.linkedin_url || null,
      timezone: r.timezone || null,
      custom: r.custom ?? {},
      tags: importTags,
    }));

  if (!rows.length) return NextResponse.json({ imported: 0, skipped: body.rows.length, list_id: listId });

  const { data, error } = await supabase
    .from("leads")
    .upsert(rows, { onConflict: "workspace_id,email", ignoreDuplicates: true })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    imported: data?.length ?? 0,
    skipped: body.rows.length - (data?.length ?? 0),
    list_id: listId,
  });
}
