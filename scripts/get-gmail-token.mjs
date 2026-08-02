// One-time setup helper: obtains a Gmail OAuth2 refresh token for GMAIL_REFRESH_TOKEN.
//
// Usage:
//   1. Create an OAuth 2.0 Client ID (type "Desktop app") in Google Cloud Console for
//      the Google account/mailbox that receives Booking.com emails, with the Gmail API
//      enabled on the project. Add "http://localhost:53682/oauth2callback" as an
//      authorized redirect URI on that client.
//   2. GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/get-gmail-token.mjs
//   3. Open the printed URL, sign in as the mailbox that should be polled, approve access.
//   4. The refresh token is printed to the terminal - copy it into GMAIL_REFRESH_TOKEN.

import http from "node:http";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars before running this script.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a refresh token to be issued even on repeat runs
  scope: ["https://www.googleapis.com/auth/gmail.modify"],
});

console.log("\nOpen this URL, sign in as the mailbox to poll, and approve access:\n");
console.log(authUrl + "\n");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("Missing code");
    return;
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Success - you can close this tab and return to the terminal.");
    console.log("\nRefresh token (copy into GMAIL_REFRESH_TOKEN):\n");
    console.log(tokens.refresh_token ?? "(none returned - remove any prior app authorization in your Google Account and re-run with prompt=consent)");
  } catch (err) {
    res.writeHead(500);
    res.end("Token exchange failed - see terminal.");
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(PORT);
