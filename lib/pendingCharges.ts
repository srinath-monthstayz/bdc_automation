import {
  TABLES,
  PROPERTIES_FIELDS,
  PENDING_CHARGES_FIELDS,
  MASTER_TRIPS_FIELDS,
  CHOICES,
} from "./airtableIds";
import { listRecords, getRecord, createRecordVerified, escapeFormulaString, AirtableRecord } from "./airtableClient";
import { fetchNewBookingEmails, markThreadProcessed, ParsedBookingEmail } from "./gmail";
import { RunLogger } from "./logger";
import { Deadline } from "./deadline";

async function findPropertyByHotelId(hotelId: string) {
  // Some hotel_ids genuinely cover more than a handful of units (confirmed live: one
  // covers at least 6 Riviera Jomtien condos) - capping this low would silently drop
  // real candidates instead of just being a defensive limit.
  const matches = await listRecords(TABLES.PROPERTIES, {
    filterByFormula: `{${PROPERTIES_FIELDS.HOTEL_ID}} = "${escapeFormulaString(hotelId)}"`,
    maxRecords: 50,
    fields: [PROPERTIES_FIELDS.HOTEL_ID, PROPERTIES_FIELDS.GOOGLE_CALENDAR_ID, PROPERTIES_FIELDS.INTERNAL_LISTING_NAME],
  });
  return matches;
}

// The Internal Listing Name formula field occasionally comes back blank on a fresh
// list/filter read (the same base-wide staleness issue that affects writes), which
// otherwise leaves the Notes field showing raw record IDs twice - useless for staff
// trying to pick the right unit. One short retry per candidate is cheap since this
// only runs on the rare ambiguous-hotel_id path.
async function describeProperty(record: AirtableRecord): Promise<string> {
  let name = record.fields[PROPERTIES_FIELDS.INTERNAL_LISTING_NAME];
  if (!name) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const refetched = await getRecord(TABLES.PROPERTIES, record.id);
    name = refetched.fields[PROPERTIES_FIELDS.INTERNAL_LISTING_NAME];
  }
  return `${name ?? "(name unavailable)"} (${record.id})`;
}

async function pendingChargeExists(confirmationCode: string): Promise<boolean> {
  const matches = await listRecords(TABLES.PENDING_CHARGES, {
    filterByFormula: `{${PENDING_CHARGES_FIELDS.CONFIRMATION_CODE}} = "${escapeFormulaString(confirmationCode)}"`,
    maxRecords: 1,
  });
  return matches.length > 0;
}

async function masterTripAlreadyExists(confirmationCode: string): Promise<boolean> {
  const matches = await listRecords(TABLES.MASTER_TRIPS, {
    filterByFormula: `FIND("${escapeFormulaString(confirmationCode)}", {${MASTER_TRIPS_FIELDS.COMMENTS}}) > 0`,
    maxRecords: 1,
  });
  return matches.length > 0;
}

const STALE_GRACE_DAYS = 2;

// Booking.com emails don't carry a "created at" signal we can trust for staleness (the
// mailbox may have years of backlog with no "processed" label yet), so this uses the
// tentative arrival date instead: a booking whose check-in already passed is historical,
// not something this automation should ever act on - regardless of whether its
// property's Hotel ID later gets mapped. Bookings with a future date are never stale,
// no matter how far out (Booking.com reservations are routinely made a year ahead).
function isStaleBooking(tentativeArrivalDate: string | null): boolean {
  if (!tentativeArrivalDate) return false;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - STALE_GRACE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return tentativeArrivalDate < cutoffStr;
}

async function processOne(email: ParsedBookingEmail, log: RunLogger): Promise<void> {
  const subject = email.subject;

  if (await pendingChargeExists(email.confirmationCode)) {
    log.skipped(subject, "duplicate: pending charge already exists for this confirmation code", { confirmationCode: email.confirmationCode });
    await markThreadProcessed(email.threadId);
    return;
  }
  if (await masterTripAlreadyExists(email.confirmationCode)) {
    log.skipped(subject, "duplicate: a Master Trip already references this confirmation code", { confirmationCode: email.confirmationCode });
    await markThreadProcessed(email.threadId);
    return;
  }

  if (isStaleBooking(email.tentativeArrivalDate)) {
    log.skipped(subject, "historical booking: check-in date is in the past, never creating a pending charge for it, regardless of property mapping", {
      confirmationCode: email.confirmationCode,
      tentativeArrivalDate: email.tentativeArrivalDate,
    });
    await markThreadProcessed(email.threadId);
    return;
  }

  if (!email.hotelId) {
    log.errored(subject, "could not extract hotel_id from email body; left unlabeled for retry", { confirmationCode: email.confirmationCode });
    return; // do not mark processed - retry next poll in case a future parser fix helps
  }

  const propertyMatches = await findPropertyByHotelId(email.hotelId);
  if (propertyMatches.length === 0) {
    log.skipped(subject, "property unresolved: no Properties record has this Hotel ID - map it once in Airtable, then this booking will resolve on the next poll", {
      confirmationCode: email.confirmationCode,
      hotelId: email.hotelId,
    });
    return; // do not mark processed - self-heals once the user maps the Hotel ID
  }

  const baseFields = {
    [PENDING_CHARGES_FIELDS.CONFIRMATION_CODE]: email.confirmationCode,
    [PENDING_CHARGES_FIELDS.GMAIL_THREAD_ID]: email.threadId,
    [PENDING_CHARGES_FIELDS.STATUS]: CHOICES.PENDING_STATUS_AWAITING_CHARGE,
    ...(email.tentativeArrivalDate ? { [PENDING_CHARGES_FIELDS.ARRIVAL_DATE]: email.tentativeArrivalDate } : {}),
  };

  if (propertyMatches.length > 1) {
    // Booking.com sometimes bundles several physical units as different "room types"
    // under one shared hotel_id, and the notification email never says which room type
    // was booked - so this genuinely can't be auto-resolved. Never guess: create the
    // record anyway (so staff see it) with Property left blank for them to pick after
    // checking the extranet, same as the other extranet-only fields they already fill in.
    const candidateNames = (await Promise.all(propertyMatches.map(describeProperty))).join(", ");
    await createRecordVerified(TABLES.PENDING_CHARGES, {
      ...baseFields,
      [PENDING_CHARGES_FIELDS.NOTES]: `Hotel ID ${email.hotelId} matches multiple properties - this Booking.com listing likely bundles several units as room types under one hotel_id. Open the extranet booking page to see which unit was actually booked, then set Property manually. Candidates: ${candidateNames}`,
    });
    await markThreadProcessed(email.threadId);
    log.processed(subject, "created pending record with Property left blank - hotel_id matches multiple properties, staff must pick the correct one from the extranet", {
      confirmationCode: email.confirmationCode,
      hotelId: email.hotelId,
      candidateRecordIds: propertyMatches.map((m) => m.id),
    });
    return;
  }

  const property = propertyMatches[0];
  await createRecordVerified(TABLES.PENDING_CHARGES, {
    ...baseFields,
    [PENDING_CHARGES_FIELDS.PROPERTY]: [property.id],
  });
  await markThreadProcessed(email.threadId);
  log.processed(subject, "created Booking.com Pending Charges record (Awaiting charge) - arrival date is tentative from the subject line, staff must verify against the extranet page along with guest/price details", {
    confirmationCode: email.confirmationCode,
    hotelId: email.hotelId,
    propertyRecordId: property.id,
  });
}

export async function pollBookingComEmails(log: RunLogger, deadline: Deadline): Promise<void> {
  const emails = await fetchNewBookingEmails();
  for (const email of emails) {
    if (deadline.exceeded()) {
      log.skipped("gmail poll", `time budget exceeded - ${emails.length - emails.indexOf(email)} email(s) left for the next run`);
      break;
    }
    try {
      await processOne(email, log);
    } catch (err) {
      log.errored(email.subject, "unexpected error while processing", { error: String(err) });
    }
  }
}
