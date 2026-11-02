/**
 * WHAT ONE SPREADSHEET REQUEST MAY COST (S13-066).
 *
 * parse-spreadsheet runs with verify_jwt off, so anyone holding the
 * publishable key could post workbooks of any size in a loop, ask it to fetch
 * any public Google Sheet with no timeout or byte cap, and hand every upload to
 * a SheetJS release with a prototype-pollution and a ReDoS advisory. parse-pdf
 * and parse-docx had a 10 MB cap and a per-address limiter; this had neither.
 *
 * The bounds, in one place so the handler and the tests read the same numbers:
 *   - a request body (a workbook, a CSV, or JSON content) of at most
 *     MAX_UPLOAD_BYTES, refused with 413 before it is parsed;
 *   - a Google Sheets export read for at most SHEETS_FETCH_MS and at most
 *     MAX_UPLOAD_BYTES, refused once either is passed;
 *   - at most MAX_ROWS rows read from a workbook;
 *   - PER_ADDRESS_PER_HOUR requests an hour from one address (the platform's,
 *     never a header the caller writes), counted by check_rate_limit.
 *
 * Plain TypeScript with no imports, so the Node test suite runs it directly.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SHEETS_FETCH_MS = 15_000;
export const MAX_ROWS = 5_000;
export const PER_ADDRESS_PER_HOUR = 20;

/** The body's declared length when it is past the cap; null when it is within it or not declared. */
export function declaredTooLarge(headers: Headers, max = MAX_UPLOAD_BYTES): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  // A multipart body wraps the file in a few hundred bytes of boundaries.
  return n > max + 64 * 1024 ? n : null;
}

export class TooLarge extends Error {
  constructor(public readonly limit: number) {
    super(`larger than ${limit} bytes`);
  }
}

/**
 * A response body as text, read only up to `max` bytes: past it the read is
 * cancelled and TooLarge is thrown, so a huge export never sits whole in the
 * isolate's memory.
 */
export async function readCapped(res: Response, max = MAX_UPLOAD_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new TooLarge(max);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge(max);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}
