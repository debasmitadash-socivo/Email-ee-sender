import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFromMailbox } from "@/lib/send";
import type { Mailbox } from "@/lib/types";

export const dynamic = "force-dynamic";

// Send a test email from a connected mailbox to a given address.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  // RLS check: the mailbox is only visible to workspace members
  const { data: mailbox } = await supabase.from("mailboxes").select("*").eq("id", params.id).maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { to } = await req.json();
  if (!to || typeof to !== "string") return NextResponse.json({ error: "to required" }, { status: 400 });

  try {
    const admin = createAdminClient();
    const result = await sendFromMailbox(admin, mailbox as Mailbox, {
      to,
      subject: "Socivo Outreach Engine — test email",
      text: `This is a test email from ${mailbox.email} sent via the ${mailbox.provider === "google" ? "Gmail API" : "Microsoft Graph API"}.\n\nIf you can read this, the mailbox connection works.`,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
