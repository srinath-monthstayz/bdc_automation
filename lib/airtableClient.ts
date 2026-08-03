import { BASE_ID } from "./airtableIds";
import { env } from "./env";

const API_ROOT = "https://api.airtable.com/v0";

type FieldValue = string | number | boolean | string[] | null | undefined;
export type Fields = Record<string, FieldValue>;

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Fields;
}

async function airtableFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_ROOT}/${BASE_ID}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_PAT}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error ${res.status} on ${path}: ${body}`);
  }
  return res.json();
}

export async function listRecords(
  tableId: string,
  params: { filterByFormula?: string; maxRecords?: number; fields?: string[] } = {}
): Promise<AirtableRecord[]> {
  const search = new URLSearchParams();
  if (params.filterByFormula) search.set("filterByFormula", params.filterByFormula);
  if (params.maxRecords) search.set("maxRecords", String(params.maxRecords));
  for (const f of params.fields ?? []) search.append("fields[]", f);

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    if (offset) search.set("offset", offset);
    const data = await airtableFetch(`${tableId}?${search.toString()}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

export async function getRecord(tableId: string, recordId: string): Promise<AirtableRecord> {
  return airtableFetch(`${tableId}/${recordId}`);
}

async function createRecordRaw(tableId: string, fields: Fields): Promise<AirtableRecord> {
  const data = await airtableFetch(tableId, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] }),
  });
  return data.records[0];
}

async function updateRecordRaw(tableId: string, recordId: string, fields: Fields): Promise<AirtableRecord> {
  const data = await airtableFetch(tableId, {
    method: "PATCH",
    body: JSON.stringify({ records: [{ id: recordId, fields }] }),
  });
  return data.records[0];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valuesMatch(expected: FieldValue, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    const a = [...expected].sort();
    const b = [...(actual as string[])].sort();
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return expected === actual;
}

function fieldsPersisted(sentFields: Fields, record: AirtableRecord): boolean {
  return Object.entries(sentFields).every(([key, value]) => valuesMatch(value, record.fields[key]));
}

/**
 * This base's search index lags and writes occasionally don't persist on the first
 * read-back, so every create/update here is re-fetched by record ID until the fields
 * we sent are confirmed present — never trust the write response alone. Most writes
 * verify on the first or second check (near-zero extra cost); backoff only grows for
 * the rare straggler, so this stays cheap in the common case despite the generous cap.
 */
const VERIFY_BACKOFF_MS = [500, 800, 1200, 1800, 2700, 4000];

export async function createRecordVerified(tableId: string, fields: Fields): Promise<AirtableRecord> {
  const created = await createRecordRaw(tableId, fields);
  for (let attempt = 0; attempt <= VERIFY_BACKOFF_MS.length; attempt++) {
    const fetched = await getRecord(tableId, created.id);
    if (fieldsPersisted(fields, fetched)) return fetched;
    await sleep(VERIFY_BACKOFF_MS[attempt] ?? VERIFY_BACKOFF_MS[VERIFY_BACKOFF_MS.length - 1]);
  }
  throw new Error(`Airtable write did not persist after create: table=${tableId} record=${created.id}`);
}

export async function updateRecordVerified(tableId: string, recordId: string, fields: Fields): Promise<AirtableRecord> {
  await updateRecordRaw(tableId, recordId, fields);
  for (let attempt = 0; attempt <= VERIFY_BACKOFF_MS.length; attempt++) {
    const fetched = await getRecord(tableId, recordId);
    if (fieldsPersisted(fields, fetched)) return fetched;
    await sleep(VERIFY_BACKOFF_MS[attempt] ?? VERIFY_BACKOFF_MS[VERIFY_BACKOFF_MS.length - 1]);
  }
  throw new Error(`Airtable write did not persist after update: table=${tableId} record=${recordId}`);
}

export function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
