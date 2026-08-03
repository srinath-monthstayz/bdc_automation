import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pollBookingComEmails } from "@/lib/pendingCharges";
import { processReadyPendingCharges } from "@/lib/tripCreation";
import { RunLogger } from "@/lib/logger";
import { Deadline } from "@/lib/deadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kept well under maxDuration so the function always returns a clean summary instead
// of getting hard-killed mid-run - a backlog just drains a bit more per 5-minute run.
const TIME_BUDGET_MS = 45_000;

// Called every 5 minutes by the GitHub Actions workflow (see .github/workflows),
// since the Vercel account is on the free Hobby plan whose native Cron only fires daily.
//
// Two independent jobs run back to back on the same schedule, sharing one time budget:
//   1. Poll Gmail for new Booking.com notification emails -> create pending records.
//   2. Pick up any pending record staff have ticked "Ready to Create Trip" on -> create
//      the Master Trip, CRM contact, and calendar block.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const log = new RunLogger();
  const deadline = new Deadline(TIME_BUDGET_MS);
  try {
    await pollBookingComEmails(log, deadline);
    await processReadyPendingCharges(log, deadline);
    return NextResponse.json(log.summary());
  } catch (err) {
    console.error(JSON.stringify({ level: "error", outcome: "errored", reason: "poll run crashed", detail: String(err) }));
    return NextResponse.json({ error: "poll run crashed", detail: String(err), partial: log.summary() }, { status: 500 });
  }
}
