import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyWebhookSignature } from "@/lib/stripeClient";
import { handleChargeSucceeded } from "@/lib/tripCreation";
import { RunLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json({ error: "missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", reason: "stripe signature verification failed", detail: String(err) }));
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const log = new RunLogger();

  try {
    if (event.type === "charge.succeeded") {
      await handleChargeSucceeded(event.data.object as Stripe.Charge, log);
    } else {
      log.skipped(event.type, "event type is not handled by this webhook");
    }
  } catch (err) {
    // A real charge already succeeded, so a transient failure here (Airtable/Calendar
    // outage, network blip) must not silently drop the trip. Return 5xx so Stripe retries
    // with backoff - the idempotency checks in handleChargeSucceeded make retries safe.
    log.errored(event.type, "unexpected error while handling event - returning 500 so Stripe retries", { error: String(err) });
    return NextResponse.json(log.summary(), { status: 500 });
  }

  return NextResponse.json(log.summary());
}
