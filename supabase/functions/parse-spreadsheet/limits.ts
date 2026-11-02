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
 *     MAX_UPLOAD_BYTES, refused with 413 before it is parsed, and read through
 *     a byte count that stops at the cap whether or not the request declares
 *     its length (readBodyCapped: a chunked upload with no Content-Length was
 *     buffered whole by formData() first; the fixer's review);
 *   - a zipped workbook (xlsx, ods: anything that starts "PK") whose entries
 *     unpack past MAX_UNZIPPED_BYTES in all, or that holds more than
 *     MAX_ZIP_ENTRIES entries, is refused BEFORE SheetJS reads it
 *     (zipInflationRefusal: SheetJS's sheetRows bounds only the rows it
 *     emits, not the inflation of sharedStrings or styles, so a 9 MB file
 *     that unpacks to gigabytes ran the isolate out of memory). The entries
 *     are measured by inflating them under the cap, so a central directory
 *     that understates a size is caught too;
 *   - a Google Sheets export read for at most SHEETS_FETCH_MS and at most
 *     MAX_UPLOAD_BYTES, refused once either is passed (the clock is the
 *     export fetch's only; the bounds above are what bound a parse);
 *   - at most MAX_ROWS rows read from a workbook;
 *   - PER_ADDRESS_PER_HOUR requests an hour from one address (the platform's,
 *     never a header the caller writes), counted by check_rate_limit. A
 *     limiter that cannot be read lets the request through, as parse-pdf's
 *     does; every request is bounded by the caps above either way.
 *
 * Plain TypeScript with no imports, so the Node test suite runs it directly.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SHEETS_FETCH_MS = 15_000;
export const MAX_ROWS = 5_000;
export const PER_ADDRESS_PER_HOUR = 20;
export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2_000;
/** A multipart body wraps the file in a few hundred bytes of boundaries. */
export const MULTIPART_SLACK_BYTES = 64 * 1024;

/** The body's declared length when it is past the cap; null when it is within it or not declared. */
export function declaredTooLarge(headers: Headers, max = MAX_UPLOAD_BYTES): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n > max + MULTIPART_SLACK_BYTES ? n : null;
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
  return new TextDecoder().decode(await streamCapped(res.body, max));
}

/**
 * A request's body as bytes, read only up to the cap plus the multipart
 * slack, declared length or not: past it the read is cancelled and TooLarge
 * is thrown.
 */
export function readBodyCapped(req: Request, max = MAX_UPLOAD_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  return streamCapped(req.body, max + MULTIPART_SLACK_BYTES);
}

async function streamCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
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
  return all;
}

/** Whether these bytes are a zip container (a local file header first). */
export function looksZipped(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/**
 * Why a zipped workbook must not be handed to the parser, or null when it may:
 * "too_large" when its entries unpack past `maxTotal` in all (or it holds more
 * than MAX_ZIP_ENTRIES, or a zip64 size), "corrupt" when its directory or an
 * entry cannot be read. Each deflated entry is inflated here under the
 * running cap and dropped, so what is counted is what the parser would build.
 */
export async function zipInflationRefusal(b: Uint8Array, maxTotal = MAX_UNZIPPED_BYTES): Promise<"too_large" | "corrupt" | null> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return "corrupt";
  const entries = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) return "too_large";
  if (entries > MAX_ZIP_ENTRIES) return "too_large";
  let p = cdOffset;
  let declared = 0;
  let unpacked = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) return "corrupt";
    const method = v.getUint16(p + 10, true);
    const packed = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const local = v.getUint32(p + 42, true);
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) return "too_large";
    declared += size;
    if (declared > maxTotal) return "too_large";
    if (local + 30 > b.length || v.getUint32(local, true) !== 0x04034b50) return "corrupt";
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + packed > b.length) return "corrupt";
    if (method === 0) unpacked += packed;
    else if (method === 8) {
      const left = maxTotal - unpacked;
      const got = await inflatedSize(b.subarray(start, start + packed), left);
      if (got === null) return "corrupt";
      unpacked += got;
    }
    if (unpacked > maxTotal) return "too_large";
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return null;
}

/** An entry's inflated size, stopping one byte past `max`; null when it is not valid deflate. */
async function inflatedSize(packed: Uint8Array, max: number): Promise<number | null> {
  // A copy of the entry's packed bytes (at most the upload's size), owned by
  // a plain ArrayBuffer as Blob wants.
  const reader = new Blob([packed.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
      if (total > max) { await reader.cancel().catch(() => {}); return total; }
    }
  } catch {
    return null;
  }
}
