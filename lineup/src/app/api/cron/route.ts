import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/service";

export const dynamic = "force-dynamic";

// Hit this hourly from any scheduler (cron-job.org, GitHub Actions, Railway/Fly cron...):
//   GET /api/cron?key=$CRON_SECRET
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.nextUrl.searchParams.get("key") !== secret) return new NextResponse("forbidden", { status: 403 });
  return NextResponse.json({ ran: await tick() });
}
