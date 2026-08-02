import Stripe from "stripe";
import {
  TABLES,
  PROPERTIES_FIELDS,
  CRM_FIELDS,
  PENDING_CHARGES_FIELDS,
  MASTER_TRIPS_FIELDS,
  CHOICES,
} from "./airtableIds";
import {
  listRecords,
  getRecord,
  createRecordVerified,
  updateRecordVerified,
  escapeFormulaString,
  AirtableRecord,
} from "./airtableClient";
import { normalizePhone, isMalformedPhone } from "./phone";
import { createAllDayBlock, getEvent } from "./googleCalendar";
import { extractConfirmationCode } from "./stripeClient";
import { RunLogger } from "./logger";

const REQUIRED_PENDING_FIELDS: Array<{ key: string; label: string }> = [
  { key: PENDING_CHARGES_FIELDS.GUEST_NAME, label: "Guest Name" },
  { key: PENDING_CHARGES_FIELDS.PROPERTY, label: "Property" },
  { key: PENDING_CHARGES_FIELDS.ARRIVAL_DATE, label: "Arrival Date" },
  { key: PENDING_CHARGES_FIELDS.CHECKOUT_DATE, label: "Checkout Date" },
  { key: PENDING_CHARGES_FIELDS.GUESTS, label: "Guests" },
  { key: PENDING_CHARGES_FIELDS.TOTAL_AMOUNT, label: "Total Amount" },
  { key: PENDING_CHARGES_FIELDS.PHONE_NUMBER, label: "Phone Number" },
];

async function findPendingChargeByCode(code: string): Promise<AirtableRecord | null> {
  const matches = await listRecords(TABLES.PENDING_CHARGES, {
    filterByFormula: `{${PENDING_CHARGES_FIELDS.CONFIRMATION_CODE}} = "${escapeFormulaString(code)}"`,
    maxRecords: 1,
  });
  return matches[0] ?? null;
}

// Guards against a retried Stripe webhook delivery landing after a prior attempt
// created the Master Trip but timed out before it could update the pending record's
// Status - without this, the retry would create a second, duplicate trip.
async function findMasterTripByConfirmationCode(confirmationCode: string): Promise<AirtableRecord | null> {
  const matches = await listRecords(TABLES.MASTER_TRIPS, {
    filterByFormula: `FIND("${escapeFormulaString(confirmationCode)}", {${MASTER_TRIPS_FIELDS.COMMENTS}}) > 0`,
    maxRecords: 1,
  });
  return matches[0] ?? null;
}

function validateComplete(record: AirtableRecord): { ok: boolean; missing: string[] } {
  const missing = REQUIRED_PENDING_FIELDS
    .filter(({ key }) => {
      const value = record.fields[key];
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    })
    .map(({ label }) => label);
  if (missing.length === 0 && isMalformedPhone(String(record.fields[PENDING_CHARGES_FIELDS.PHONE_NUMBER]))) {
    missing.push("Phone Number (malformed)");
  }
  return { ok: missing.length === 0, missing };
}

async function findCrmContactByPhone(phone: string): Promise<AirtableRecord | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const formula = `OR(RIGHT(REGEX_REPLACE({${CRM_FIELDS.PHONE_NUMBER}},"[^0-9]",""),9)="${normalized.last9}", REGEX_REPLACE({${CRM_FIELDS.PHONE_NUMBER}},"[^0-9]","")="${normalized.digitsOnly}")`;
  const matches = await listRecords(TABLES.CRM, { filterByFormula: formula, maxRecords: 1 });
  return matches[0] ?? null;
}

function splitGuestName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, spaceIdx), lastName: trimmed.slice(spaceIdx + 1) };
}

async function findOrCreateCrmContact(guestName: string, phone: string): Promise<{ record: AirtableRecord; isNew: boolean }> {
  const existing = await findCrmContactByPhone(phone);
  if (existing) return { record: existing, isNew: false };

  const { firstName, lastName } = splitGuestName(guestName);
  const created = await createRecordVerified(TABLES.CRM, {
    [CRM_FIELDS.FIRST_NAME]: firstName,
    [CRM_FIELDS.LAST_NAME]: lastName,
    [CRM_FIELDS.PHONE_NUMBER]: phone,
    [CRM_FIELDS.INITIAL_CONTACT_POINT]: CHOICES.CRM_INITIAL_CONTACT_POINT_BOOKING_COM,
  });
  return { record: created, isNew: true };
}

export async function handleChargeSucceeded(charge: Stripe.Charge, log: RunLogger): Promise<void> {
  const label = `stripe charge ${charge.id}`;
  const confirmationCode = extractConfirmationCode(charge);
  if (!confirmationCode) {
    log.errored(label, "could not find a Booking.com confirmation code in the charge description/metadata - staff must add it and we cannot auto-retry a webhook delivery", { chargeId: charge.id });
    return;
  }

  const pending = await findPendingChargeByCode(confirmationCode);
  if (!pending) {
    log.errored(label, "no 'Awaiting charge' pending record found for this confirmation code", { confirmationCode, chargeId: charge.id });
    return;
  }

  if (pending.fields[PENDING_CHARGES_FIELDS.STATUS] === CHOICES.PENDING_STATUS_CHARGED) {
    log.skipped(label, "idempotent no-op: this pending record was already marked Charged - trip created", { confirmationCode, pendingRecordId: pending.id });
    return;
  }

  const { ok, missing } = validateComplete(pending);
  if (!ok) {
    await updateRecordVerified(TABLES.PENDING_CHARGES, pending.id, {
      [PENDING_CHARGES_FIELDS.STATUS]: CHOICES.PENDING_STATUS_NEEDS_REVIEW,
    });
    log.errored(label, `charge succeeded but the pending record is missing required fields - guest has been charged, complete the record manually then re-fire this webhook event: ${missing.join(", ")}`, {
      confirmationCode,
      pendingRecordId: pending.id,
      missing,
    });
    return;
  }

  const propertyId = (pending.fields[PENDING_CHARGES_FIELDS.PROPERTY] as string[])[0];
  const property = await getRecord(TABLES.PROPERTIES, propertyId);
  const calendarId = property.fields[PROPERTIES_FIELDS.GOOGLE_CALENDAR_ID] as string | undefined;
  if (!calendarId) {
    await updateRecordVerified(TABLES.PENDING_CHARGES, pending.id, {
      [PENDING_CHARGES_FIELDS.STATUS]: CHOICES.PENDING_STATUS_NEEDS_REVIEW,
    });
    log.errored(label, "property has no Google Calendar ID configured - cannot block the calendar", { confirmationCode, propertyId });
    return;
  }

  const guestName = String(pending.fields[PENDING_CHARGES_FIELDS.GUEST_NAME]);
  const phone = String(pending.fields[PENDING_CHARGES_FIELDS.PHONE_NUMBER]);
  const arrivalDate = String(pending.fields[PENDING_CHARGES_FIELDS.ARRIVAL_DATE]);
  const checkoutDate = String(pending.fields[PENDING_CHARGES_FIELDS.CHECKOUT_DATE]);
  const guests = Number(pending.fields[PENDING_CHARGES_FIELDS.GUESTS]);
  const totalAmount = Number(pending.fields[PENDING_CHARGES_FIELDS.TOTAL_AMOUNT]);
  const securityDeposit = pending.fields[PENDING_CHARGES_FIELDS.SECURITY_DEPOSIT];
  const actualAmountPaid = charge.amount / 100; // Stripe's charged amount is ground truth for what the guest actually paid

  if (charge.currency && charge.currency.toLowerCase() !== "thb") {
    log.errored(label, `Stripe charge currency is "${charge.currency}", not THB - Actual Amount Paid was still recorded as amount/100, please verify manually`, { confirmationCode, currency: charge.currency });
  }

  // Step 1: get-or-create the Master Trip. Keyed off Comments containing the
  // confirmation code, so a retried webhook delivery never creates a second trip.
  let masterTrip = await findMasterTripByConfirmationCode(confirmationCode);
  let crmContactId: string | null = null;
  let crmContactIsNew = false;
  if (masterTrip) {
    log.skipped(label, "Master Trip already exists for this confirmation code (retried delivery) - reusing it", { confirmationCode, masterTripId: masterTrip.id });
  } else {
    const { record: crmContact, isNew } = await findOrCreateCrmContact(guestName, phone);
    crmContactId = crmContact.id;
    crmContactIsNew = isNew;

    const comments = `Booking.com confirmation: ${confirmationCode} | Arrival: ${arrivalDate} | Checkout: ${checkoutDate} | Stripe charge: ${charge.id}`;
    masterTrip = await createRecordVerified(TABLES.MASTER_TRIPS, {
      [MASTER_TRIPS_FIELDS.PROPERTY]: [propertyId],
      [MASTER_TRIPS_FIELDS.BOOKING_CHANNEL]: CHOICES.BOOKING_CHANNEL_BOOKING_COM,
      [MASTER_TRIPS_FIELDS.ARRIVAL_DATE]: arrivalDate,
      [MASTER_TRIPS_FIELDS.CHECKOUT_DATE]: checkoutDate,
      [MASTER_TRIPS_FIELDS.PAYMENT_STATUS]: CHOICES.PAYMENT_STATUS_FULLY_PAID,
      [MASTER_TRIPS_FIELDS.NUMBER_OF_GUESTS]: guests,
      [MASTER_TRIPS_FIELDS.COMMENTS]: comments,
      [MASTER_TRIPS_FIELDS.AGREED_COST]: totalAmount,
      ...(typeof securityDeposit === "number" ? { [MASTER_TRIPS_FIELDS.SECURITY_DEPOSIT]: securityDeposit } : {}),
      [MASTER_TRIPS_FIELDS.ACTUAL_AMOUNT_PAID]: actualAmountPaid,
      [MASTER_TRIPS_FIELDS.INQUIRY_STATUS]: CHOICES.INQUIRY_STATUS_PAID_AND_CONFIRMED,
      [MASTER_TRIPS_FIELDS.INQUIRY_FROM]: CHOICES.INQUIRY_FROM_CUSTOMER,
      [MASTER_TRIPS_FIELDS.INQUIRY_TYPE]: isNew ? CHOICES.INQUIRY_TYPE_FRESH : CHOICES.INQUIRY_TYPE_REPEAT,
      [MASTER_TRIPS_FIELDS.CRM_CONTACT]: [crmContact.id],
      [MASTER_TRIPS_FIELDS.PENDING_CHARGES_LINK]: [pending.id],
    });
  }

  // Step 2: get-or-create the calendar block. Keyed off the pending record's own
  // Calendar Event ID field, so a retry after Step 1 succeeded but the process died
  // before this step (or before Step 3) never creates a second calendar event.
  const existingEventId = pending.fields[PENDING_CHARGES_FIELDS.CALENDAR_EVENT_ID] as string | undefined;
  let eventId = existingEventId;
  if (existingEventId) {
    const verifiedEvent = await getEvent(calendarId, existingEventId);
    if (verifiedEvent.status !== "confirmed") {
      log.errored(label, `existing calendar event status is "${verifiedEvent.status}", not "confirmed"`, { confirmationCode, eventId: existingEventId, calendarId });
    }
  } else {
    const event = await createAllDayBlock({
      calendarId,
      summary: `${guestName} | Booking.com | ${confirmationCode} (${guests} guest${guests === 1 ? "" : "s"})`,
      startDate: arrivalDate,
      endDateExclusive: checkoutDate,
    });
    eventId = event.id!;
    const verifiedEvent = await getEvent(calendarId, eventId);
    if (verifiedEvent.status !== "confirmed") {
      log.errored(label, `calendar event was created but its status is "${verifiedEvent.status}", not "confirmed"`, { confirmationCode, eventId, calendarId });
    }
  }

  // Step 3: mark the pending record done. Safe to repeat with identical values.
  await updateRecordVerified(TABLES.PENDING_CHARGES, pending.id, {
    [PENDING_CHARGES_FIELDS.STATUS]: CHOICES.PENDING_STATUS_CHARGED,
    [PENDING_CHARGES_FIELDS.MASTER_TRIP]: [masterTrip.id],
    [PENDING_CHARGES_FIELDS.CALENDAR_EVENT_ID]: eventId!,
  });

  log.processed(label, "created/reused Master Trip, linked/created CRM contact, and blocked/verified the calendar", {
    confirmationCode,
    masterTripId: masterTrip.id,
    crmContactId,
    crmContactIsNew,
    calendarEventId: eventId,
  });
}
