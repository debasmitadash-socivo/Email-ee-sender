import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkDns } from "@/lib/dns";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const domain = req.nextUrl.searchParams.get("domain");
  const provider = req.nextUrl.searchParams.get("provider");
  if (!domain || (provider !== "google" && provider !== "microsoft")) {
    return NextResponse.json({ error: "domain and provider (google|microsoft) required" }, { status: 400 });
  }
  const result = await checkDns(domain, provider);
  return NextResponse.json(result);
}
