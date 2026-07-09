import { NextResponse } from "next/server";
import { checkEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Public health endpoint. Also the keep-alive target for pg_cron's daily
// self-ping and the cron-job.org backup ping.
export async function GET() {
  const env = checkEnv();
  return NextResponse.json({
    ok: env.ok,
    missing: env.missing,
    degraded: env.degraded,
    time: new Date().toISOString(),
  });
}
