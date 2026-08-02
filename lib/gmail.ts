import { google, gmail_v1 } from "googleapis";
import { env } from "./env";

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

export interface ParsedBookingEmail {
  messageId: string;
  threadId: string;
  subject: string;
  confirmationCode: string;
  hotelId: string | null;
  tentativeArrivalDate: string | null; // YYYY-MM-DD, best-effort from subject only
}

function getGmailClient(): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

// Subject looks like: "Booking.com - New booking! (5675546199, Friday, August 7, 2026)"
export function parseSubject(subject: string): { confirmationCode: string | null; tentativeArrivalDate: string | null } {
  const match = subject.match(/\((\d+),\s*([^)]+)\)/);
  if (!match) return { confirmationCode: null, tentativeArrivalDate: null };
  const confirmationCode = match[1];
  const dateText = match[2]; // "Friday, August 7, 2026"
  const dateMatch = dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  let tentativeArrivalDate: string | null = null;
  if (dateMatch) {
    const month = MONTHS[dateMatch[1].toLowerCase()];
    const day = dateMatch[2].padStart(2, "0");
    const year = dateMatch[3];
    if (month) tentativeArrivalDate = `${year}-${month}-${day}`;
  }
  return { confirmationCode, tentativeArrivalDate };
}

export function extractHotelId(body: string): string | null {
  const match = body.match(/hotel_id=(\d+)/);
  return match ? match[1] : null;
}

function decodeBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  let combined = "";
  for (const sub of part.parts ?? []) {
    combined += decodeBody(sub);
  }
  return combined;
}

async function getOrCreateLabelId(gmail: gmail_v1.Gmail, name: string): Promise<string> {
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = list.data.labels?.find((l) => l.name === name);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  return created.data.id!;
}

export async function fetchNewBookingEmails(): Promise<ParsedBookingEmail[]> {
  const gmail = getGmailClient();
  const query = `${env.GMAIL_QUERY} -label:"${env.GMAIL_LABEL_PROCESSED}"`;
  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 50 });

  const results: ParsedBookingEmail[] = [];
  for (const item of list.data.messages ?? []) {
    if (!item.id) continue;
    const full = await gmail.users.messages.get({ userId: "me", id: item.id, format: "full" });
    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const body = decodeBody(full.data.payload);
    const { confirmationCode, tentativeArrivalDate } = parseSubject(subject);
    if (!confirmationCode) continue; // not a recognizable "New booking!" email; leave unlabeled for manual review
    results.push({
      messageId: item.id,
      threadId: full.data.threadId!,
      subject,
      confirmationCode,
      hotelId: extractHotelId(body),
      tentativeArrivalDate,
    });
  }
  return results;
}

export async function markThreadProcessed(threadId: string): Promise<void> {
  const gmail = getGmailClient();
  const labelId = await getOrCreateLabelId(gmail, env.GMAIL_LABEL_PROCESSED);
  await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds: [labelId] } });
}
