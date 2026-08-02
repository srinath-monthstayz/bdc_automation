import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pollBookingComEmails } from "@/lib/pendingCharges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 5 minutes by the GitHub Actions workflow (see .github/workflows),
// since the Vercel account is on the free Hobby plan whose native Cron only fires daily.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await pollBookingComEmails();
    return NextResponse.json(summary);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", outcome: "errored", reason: "poll run crashed", detail: String(err) }));
    return NextResponse.json({ error: "poll run crashed", detail: String(err) }, { status: 500 });
  }
}
