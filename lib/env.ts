function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  get AIRTABLE_PAT() {
    return required("AIRTABLE_PAT");
  },
  get CRON_SECRET() {
    return required("CRON_SECRET");
  },
  get GMAIL_QUERY() {
    return process.env.GMAIL_QUERY || 'from:noreply@booking.com subject:"New booking!"';
  },
  get GMAIL_LABEL_PROCESSED() {
    return process.env.GMAIL_LABEL_PROCESSED || "gsg-booking-automation/processed";
  },
  get GMAIL_CLIENT_ID() {
    return required("GMAIL_CLIENT_ID");
  },
  get GMAIL_CLIENT_SECRET() {
    return required("GMAIL_CLIENT_SECRET");
  },
  get GMAIL_REFRESH_TOKEN() {
    return required("GMAIL_REFRESH_TOKEN");
  },
  get GOOGLE_SERVICE_ACCOUNT_EMAIL() {
    return required("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  },
  get GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY() {
    // Vercel env vars can't contain literal newlines in the dashboard UI, so the
    // private key is stored with \n escapes and unescaped here.
    return required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");
  },
  get STRIPE_SECRET_KEY() {
    return required("STRIPE_SECRET_KEY");
  },
  get STRIPE_WEBHOOK_SECRET() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
};
