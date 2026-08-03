// Airtable "Main" base — IDs only, never display names, per Airtable API requirements.
export const BASE_ID = "appND9kP55cvkDX7V";

export const TABLES = {
  MASTER_TRIPS: "tblodAjjJy8FBQAY7",
  PROPERTIES: "tblYsjDyc84qS0cSw",
  CRM: "tbljAtpRqo0s1siQe",
  PENDING_CHARGES: "tbll0lub1fDdxBSUB",
} as const;

export const MASTER_TRIPS_FIELDS = {
  PROPERTY: "fldEkJorW6llGqI08",
  BOOKING_CHANNEL: "fldrmnsj1lsZO9UoJ",
  ARRIVAL_DATE: "fldu81bwcyq86aBKz",
  CHECKOUT_DATE: "fldiQISqiSkO45tvn",
  PAYMENT_STATUS: "fld6Fm1g7VYsmKVl1",
  NUMBER_OF_GUESTS: "fldlPEchlM3BssJYx",
  COMMENTS: "fld63KH9a06DGbgKT",
  AGREED_COST: "fldCmeh4OXrF5wt5m",
  INQUIRY_STATUS: "fldxU0AyJl5bkeDg2",
  INQUIRY_FROM: "fld5b1Op3s0x32AI4",
  INQUIRY_TYPE: "fldgsJ8a2SgBVU5VT",
  SECURITY_DEPOSIT: "fld9R07PzqUejDI5v",
  ACTUAL_AMOUNT_PAID: "fldbOTdIWGDUpeIjt",
  CRM_CONTACT: "fldY3YO3qh41ApmxJ",
  PENDING_CHARGES_LINK: "fld5cOvAcwfAFbAk2",
} as const;

export const PROPERTIES_FIELDS = {
  HOTEL_ID: "fldK2YUzG0KLZESob",
  GOOGLE_CALENDAR_ID: "flds2Pkaxh2nx4Kjc",
  AIRBNB_NAME: "fldcA6qs3nXsBdoU1",
} as const;

export const CRM_FIELDS = {
  FIRST_NAME: "fldpQDbt3mhS7JENm",
  LAST_NAME: "fldeMrtoK6oqx1tNW",
  PHONE_NUMBER: "flddoNYFVjr1w4uq6",
  INITIAL_CONTACT_POINT: "fld8cQZ307o5NyUAe",
} as const;

export const PENDING_CHARGES_FIELDS = {
  CONFIRMATION_CODE: "fldB8hp9YsTpePKxU",
  GUEST_NAME: "fld5ssbq7VxmHAXuV",
  PROPERTY: "fldiRVgvepNwELx4V",
  ARRIVAL_DATE: "fldvHAZkpei2Xo4rH",
  CHECKOUT_DATE: "fldTZrgD25nHHQmEp",
  GUESTS: "fld041HQDUTYxAwD8",
  TOTAL_AMOUNT: "fldK4xY3a73YyLeSz",
  CURRENCY: "fld6eRsiceJSJ6ZuG",
  GMAIL_THREAD_ID: "fldqv28NOF8GYin7j",
  STATUS: "fldV0oVpKj1RQhb0o",
  MASTER_TRIP: "fld96oqrD9xVLV4AO",
  PHONE_NUMBER: "fldXbzeD6uLlV3JUm",
  SECURITY_DEPOSIT: "fldLqo5HV25anbZ3g",
  ACTUAL_AMOUNT_PAID: "fldq384CrhQR6TChS",
  CALENDAR_EVENT_ID: "fldegoX5mtiVd0s5w",
  READY_TO_CREATE_TRIP: "fldndF6zGFFHtxOdp",
} as const;

// singleSelect choice display names (Airtable's REST API writes selects by name, not by choice ID).
export const CHOICES = {
  BOOKING_CHANNEL_BOOKING_COM: "Booking.com",
  PAYMENT_STATUS_FULLY_PAID: "Fully paid",
  INQUIRY_STATUS_PAID_AND_CONFIRMED: "Paid and confirmed",
  INQUIRY_FROM_CUSTOMER: "Customer",
  INQUIRY_TYPE_FRESH: "Fresh",
  INQUIRY_TYPE_REPEAT: "Repeat",
  CRM_INITIAL_CONTACT_POINT_BOOKING_COM: "Booking.com",
  PENDING_STATUS_AWAITING_CHARGE: "Awaiting charge",
  PENDING_STATUS_CHARGED: "Charged - trip created",
  PENDING_STATUS_NEEDS_REVIEW: "Charge failed / needs review",
} as const;
