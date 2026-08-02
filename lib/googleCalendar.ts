import { google, calendar_v3 } from "googleapis";
import { env } from "./env";

const TIMEZONE = "Asia/Bangkok";

function getCalendarClient(): calendar_v3.Calendar {
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

// Booking.com's checkout date is exclusive in our Airtable schema already, matching how
// Google Calendar all-day events treat `end.date` as exclusive — no off-by-one adjustment needed.
export async function createAllDayBlock(params: {
  calendarId: string;
  summary: string;
  startDate: string; // YYYY-MM-DD, check-in
  endDateExclusive: string; // YYYY-MM-DD, checkout
}): Promise<calendar_v3.Schema$Event> {
  const calendar = getCalendarClient();
  const res = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: params.summary,
      start: { date: params.startDate, timeZone: TIMEZONE },
      end: { date: params.endDateExclusive, timeZone: TIMEZONE },
    },
  });
  return res.data;
}

export async function getEvent(calendarId: string, eventId: string): Promise<calendar_v3.Schema$Event> {
  const calendar = getCalendarClient();
  const res = await calendar.events.get({ calendarId, eventId });
  return res.data;
}
