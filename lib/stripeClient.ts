import Stripe from "stripe";
import { env } from "./env";

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

export function verifyWebhookSignature(rawBody: string, signature: string): Stripe.Event {
  return getStripeClient().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

// Staff are asked to paste the Booking.com confirmation code into the charge's
// description or metadata.confirmation_code when charging manually in the Dashboard.
export function extractConfirmationCode(charge: Stripe.Charge): string | null {
  const fromMetadata = charge.metadata?.confirmation_code;
  if (fromMetadata) return fromMetadata.trim();
  const fromDescription = charge.description?.match(/\b(\d{9,10})\b/);
  return fromDescription ? fromDescription[1] : null;
}
