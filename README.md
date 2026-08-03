# Booking.com Automation

Turns a confirmed Booking.com reservation into an Airtable Master Trip, a CRM contact,
and a blocked Google Calendar entry — triggered by staff ticking a checkbox once
they've filled in the booking details and collected payment (however they actually
charge the guest), since Booking.com bookings aren't confirmed as paid the way Airbnb's
are.

## Why this exists, and what it actually automates

Booking.com's "New booking!" notification email is bare: it only contains a
confirmation code and a `hotel_id`. Guest name, dates, guest count, and price live on a
login-walled Booking.com extranet page, and there is no automated feed of that data into
this system. So the flow is:

1. **Gmail poll (every 5 min)** finds the notification email, extracts the confirmation
   code and `hotel_id`, matches `hotel_id` to a Properties record via its **Hotel ID**
   field, and creates a `Booking.com Pending Charges` record with `Status = Awaiting
   charge`. If the `hotel_id` doesn't match any property yet, nothing is created — it's
   logged clearly and retried on every future poll until you add that `hotel_id` to the
   right property's **Hotel ID** field (one-time, per property).
2. **Staff fill in the rest** — open the Booking.com extranet link from the email, then
   fill in **Guest Name, Checkout Date, Guests, Total Amount, Phone Number, Actual
   Amount Paid**, and optionally **Security Deposit**, directly on that Airtable
   record. (**Arrival Date** is pre-filled from the email subject as a best-effort
   guess — double check it.)
3. **Staff collect payment from the guest** (by whatever means) and then **tick "Ready
   to Create Trip"** on the pending record.
4. **The same 5-minute poll** picks up any record with that box ticked, checks all
   required fields are filled in, then creates/links the CRM contact, creates the
   Master Trip, and blocks the property's Google Calendar. If anything is missing, the
   pending record is marked `Charge failed / needs review` and the reason is logged
   loudly instead of silently doing nothing.

Every step re-fetches what it just wrote to confirm it actually persisted (this
Airtable base's search index lags and writes occasionally don't stick on the first
attempt), and every step is safe to re-run: re-processing the same email or the same
pending record never creates a duplicate pending record, trip, or calendar event.

## Architecture

- `app/api/cron/poll-booking-com/route.ts` — polled every 5 minutes by a GitHub Actions
  workflow (`.github/workflows/poll-booking-com.yml`), not Vercel's own Cron, since the
  Vercel account is on the free Hobby plan and Hobby cron jobs only fire once a day. It
  runs two jobs back to back: the Gmail poll, then the "Ready to Create Trip" sweep.
- `lib/` — Gmail, Airtable, and Google Calendar clients, plus the two business flows
  (`pendingCharges.ts` for the Gmail poll, `tripCreation.ts` for the trip/calendar
  creation sweep).

## Required environment variables

See `.env.example` for the full list with inline notes. Summary:

| Variable | Purpose |
|---|---|
| `AIRTABLE_PAT` | Airtable Personal Access Token with read/write on the Main base |
| `CRON_SECRET` | Shared secret the GitHub Actions poller sends as a Bearer token |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Gmail API OAuth2 credentials for the mailbox receiving Booking.com emails |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account for writing to property Google Calendars |

## One-time setup

### Airtable

Create a Personal Access Token (airtable.com/create/tokens) scoped to the "Main" base
with `data.records:read` and `data.records:write`. Use it as `AIRTABLE_PAT`.

### Gmail

1. In Google Cloud Console, create/select a project, enable the **Gmail API**, and
   create an OAuth 2.0 Client ID of type **Desktop app**.
2. Run the included helper to get a refresh token:
   ```bash
   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/get-gmail-token.mjs
   ```
   Open the printed URL, sign in as the mailbox that receives Booking.com emails,
   approve access, then copy the refresh token it prints.
3. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

### Google Calendar

1. Create a service account in the same (or any) Google Cloud project, enable the
   **Google Calendar API**, and generate a JSON key for it.
2. For **every property's calendar** (the "Google Calendar ID" field on each Properties
   record), share that calendar with the service account's email, with "Make changes to
   events" permission.
3. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` to the service account's email, and
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` to the JSON key's `private_key` value with real
   newlines replaced by `\n` (the app un-escapes them at runtime).

### Staff process

When a `Booking.com Pending Charges` record shows up (`Status = Awaiting charge`):

1. Open the Booking.com extranet link from the notification email.
2. Fill in Guest Name, Checkout Date, Guests, Total Amount, Phone Number, Actual
   Amount Paid, and Security Deposit (if any) on the Airtable record. Double-check the
   pre-filled Arrival Date.
3. Collect payment from the guest by whatever means.
4. Tick **Ready to Create Trip**. The trip and calendar block appear within 5 minutes.

### GitHub Actions poller

In the GitHub repo's Settings → Secrets and variables → Actions, add:

- `CRON_SECRET` — same value as the Vercel env var
- `DEPLOYMENT_URL` — the deployed app's base URL (e.g. `https://booking-com-automation.vercel.app`)

### Vercel

Import the repo into Vercel and set every environment variable above in Project
Settings → Environment Variables. No `vercel.json` cron config is needed since polling
runs via GitHub Actions instead.

## Known limitations

- **No payment verification.** Since there's no Stripe (or other payment API) hookup,
  the app trusts that "Ready to Create Trip" being ticked means payment was actually
  collected — there's no independent check.
- **Arrival Date is a best-effort guess** parsed from the email subject line, not
  confirmed against the extranet — staff should verify/correct it while filling in the
  rest of the pending record.
- **Hotel ID must be mapped per property once.** The base only had one property with a
  Hotel ID recorded when this was built; every other property's Booking.com `hotel_id`
  needs to be added to its Properties record the first time a booking for it comes in
  (the poller logs exactly which `hotel_id` is unmapped).
- **Phone matching is heuristic** (last-9-digits and digits-only comparison), which
  covers common Thai number format differences but isn't a universal E.164 matcher.
