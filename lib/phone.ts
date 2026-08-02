export interface NormalizedPhone {
  digitsOnly: string;
  last9: string;
}

/**
 * Strips everything but digits and keeps the last 9 digits (the significant national
 * number for Thai mobiles once the country code/trunk 0 is dropped) as a fuzzy match key,
 * since CRM contacts may be stored as "0812345678" or "+66812345678" or "66 81 234 5678".
 */
export function normalizePhone(raw: string): NormalizedPhone | null {
  const digitsOnly = raw.replace(/[^0-9]/g, "");
  if (digitsOnly.length < 7) return null;
  return { digitsOnly, last9: digitsOnly.slice(-9) };
}

export function isMalformedPhone(raw: string | null | undefined): boolean {
  if (!raw || raw.trim().length === 0) return true;
  return normalizePhone(raw) === null;
}
