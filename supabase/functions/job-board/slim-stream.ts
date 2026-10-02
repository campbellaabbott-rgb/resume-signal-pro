// A Lever or Ashby feed too big to hold, read one posting at a time.
// Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
//
// Pure: no I/O of its own, no database. Every failure THROWS, because a partial
// board read as complete feeds the id-diff prune and the closure log. The
// caller (readOversizeBoard in index.ts) turns any throw into "stays deferred".
import { htmlToText, isDatedBefore, safeIso, sanePostedAt } from "./normalize.ts";

const OVERSIZE_MARKER = "OVERSIZE_BODY";
type J = Record<string, unknown>;

export interface SlimSpec {
  /** null: the document IS the array (lever). Otherwise the array under this top-level key (ashby). */
  arrayKey: string | null;
  /** Exactly the fields the vendor's normaliser reads. A contract with normalize.ts; the guard derives it. */
  keep: readonly string[];
  /** A further cut inside a kept field. */
  reduce?: (slim: J) => void;
  /** The date the normaliser stores, which the ingest's 30-day test reads. */
  postedAt: (j: J) => string | null;
  /** The description text index.ts builds for this vendor, before its own cap. */
  text: (j: J) => string;
}

const pick = (j: J, keys: readonly string[]): J => {
  const o: J = {};
  for (const k of keys) if (k in j) o[k] = j[k];
  return o;
};

export const SLIM_SPECS: Record<string, SlimSpec> = {
  lever: {
    arrayKey: null,
    keep: ["id", "text", "hostedUrl", "applyUrl", "createdAt", "workplaceType", "categories", "salaryRange"],
    postedAt: (j) => safeIso(j.createdAt),
    text: (j) => (String(j.descriptionPlain ?? "") + (j.descriptionBodyPlain ? `\n${j.descriptionBodyPlain}` : "")).trim(),
  },
  ashby: {
    arrayKey: "jobs",
    keep: ["id", "title", "location", "department", "team", "isRemote", "workplaceType", "employmentType", "isListed", "publishedAt", "jobUrl", "applyUrl", "compensation"],
    reduce: (o) => {
      const c = o.compensation;
      if (c && typeof c === "object") o.compensation = pick(c as J, ["compensationTierSummary", "scrapeableCompensationSalarySummary"]);
    },
    postedAt: (j) => (typeof j.publishedAt === "string" ? j.publishedAt : null),
    text: (j) => String(j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(String(j.descriptionHtml)) : "")).trim(),
  },
};

/**
 * Settle `p` before `deadlineAt` or reject. A result that lands late is handed
 * to `late`, so a response nobody waited for is still released.
 */
export async function beforeDeadline<T>(p: Promise<T>, deadlineAt: number, late: (v: T) => void): Promise<T> {
  const left = deadlineAt - Date.now();
  if (left <= 0) {
    p.then(late, () => {});
    throw new Error(`${OVERSIZE_MARKER} slow 0`);
  }
  let t: ReturnType<typeof setTimeout> | undefined;
  let lost = false;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        t = setTimeout(() => { lost = true; rej(new Error(`${OVERSIZE_MARKER} slow ${left}`)); }, left);
      }),
    ]);
  } finally {
    clearTimeout(t);
    if (lost) p.then(late, () => {});
  }
}

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/**
 * Yield the bytes of each object (or array) element of one array in a JSON
 * document, without ever holding the document. `key` null: the document is the
 * array. Otherwise the array is the value of that key at depth 1 only.
 *
 * Throws on a document whose first byte is the wrong shape, on a target that
 * never appears, on EOF before the document closes, on one element larger than
 * `maxElementBytes`, and when a read does not arrive by `deadlineAt`.
 */
export async function* jsonArrayElements(
  body: ReadableStream<Uint8Array>,
  key: string | null,
  maxElementBytes: number,
  deadlineAt: number,
): AsyncGenerator<Uint8Array> {
  const at = key === null ? 1 : 2; // depth of the target array's elements
  const opener = key === null ? 91 : 123;
  let depth = 0, inStr = false, esc = false, started = false, found = false, closed = false;
  let lastKey = "";
  let keyBytes: number[] | null = null;
  let parts: Uint8Array[] = [], partLen = 0, elStart = -1;
  const reader = body.getReader();
  try {
    for (;;) {
      const { value: chunk, done } = await beforeDeadline(reader.read(), deadlineAt, () => {});
      if (done) break;
      if (!chunk || chunk.length === 0) continue;
      const n = chunk.length;
      // Next backslash at or after the last search; -1 none left in this chunk,
      // -2 not searched. Cached, or a long run of strings with no escape in them
      // rescans the rest of the chunk once per string.
      let bs = -2;
      let i = 0;
      if (elStart >= 0) elStart = 0;
      while (i < n) {
        if (inStr) {
          if (esc) { esc = false; if (keyBytes) keyBytes.push(chunk[i]); i++; continue; }
          let q = chunk.indexOf(34, i);
          if (q < 0) q = n;
          if (bs !== -1 && bs < i) bs = chunk.indexOf(92, i);
          const stop = bs >= 0 && bs < q ? bs : q;
          if (keyBytes) for (let k = i; k < stop && keyBytes.length < 64; k++) keyBytes.push(chunk[k]);
          if (stop >= n) { i = n; break; }
          i = stop + 1;
          if (stop === bs) { esc = true; continue; }
          inStr = false;
          if (keyBytes) { lastKey = new TextDecoder().decode(new Uint8Array(keyBytes)); keyBytes = null; }
          continue;
        }
        const c = chunk[i];
        if (!started) {
          if (isSpace(c)) { i++; continue; }
          if (c !== opener) throw new Error(`stream: the document is not ${key === null ? "an array" : "an object"}`);
          started = true;
        }
        if (c === 34) {
          inStr = true;
          if (!found && depth === 1 && key !== null) keyBytes = [];
          i++;
          continue;
        }
        if (c === 123 || c === 91) {
          if (!found && c === 91 && depth === at - 1 && (key === null || lastKey === key)) { found = true; depth++; i++; continue; }
          if (found && !closed && depth === at && elStart < 0) elStart = i;
          depth++;
          i++;
          continue;
        }
        if (c === 125 || c === 93) {
          depth--;
          if (depth < 0) throw new Error("stream: the document closes more than it opened");
          if (found && !closed && depth === at && elStart >= 0) {
            const tail = chunk.subarray(elStart, i + 1);
            let el: Uint8Array;
            if (parts.length === 0) el = tail.slice();
            else {
              el = new Uint8Array(partLen + tail.length);
              let o = 0;
              for (const p of parts) { el.set(p, o); o += p.length; }
              el.set(tail, o);
              parts = [];
              partLen = 0;
            }
            elStart = -1;
            if (el.length > maxElementBytes) throw new Error(`${OVERSIZE_MARKER} element ${el.length} > ${maxElementBytes}`);
            yield el;
          } else if (found && !closed && depth === at - 1) closed = true;
          i++;
          continue;
        }
        i++;
      }
      if (elStart >= 0) {
        parts.push(chunk.slice(elStart));
        partLen += n - elStart;
        if (partLen > maxElementBytes) throw new Error(`${OVERSIZE_MARKER} element ${partLen} > ${maxElementBytes}`);
      }
    }
    if (!found) throw new Error(`stream: no ${key === null ? "top-level" : `"${key}"`} array in the document`);
    if (!closed || depth !== 0 || inStr) throw new Error("stream: the document ended before it closed (truncated)");
  } finally {
    reader.cancel().catch(() => {});
  }
}

export interface SlimStats { elements: number; bytes: number; slimBytes: number; descKept: number; descDropped: number }
export interface SlimOptions {
  /** The ingest's own 30-day cutoff: an aged posting is never stored, so its text is never held. */
  freshCutoffMs: number;
  /** Metadata alone past this and the board stays a deferral. */
  maxBytes: number;
  maxElementBytes: number;
  /** Per posting. Twice the stored cap, so index.ts's trim-then-cap reads the same text. */
  descKeepChars: number;
  /** Metadata plus held descriptions. The OLDEST description is given up first. */
  descCeiling: number;
  deadlineAt: number;
}

/**
 * The vendor's own document shape with only the normaliser's fields kept, and
 * each in-window posting's description pre-built into `descriptionPlain`, the
 * field index.ts's description code reads first for both vendors.
 */
export async function streamSlim(
  body: ReadableStream<Uint8Array>,
  spec: SlimSpec,
  o: SlimOptions,
): Promise<{ raw: unknown; stats: SlimStats }> {
  const dec = new TextDecoder();
  const out: J[] = [];
  const st: SlimStats = { elements: 0, bytes: 0, slimBytes: 0, descKept: 0, descDropped: 0 };
  const held: Array<{ ms: number; row: J; len: number }> = [];
  let meta = 0;
  let descChars = 0;
  // Give up the oldest held description, but only one strictly older than `ms`.
  const evictOlderThan = (ms: number): boolean => {
    if (held.length === 0) return false;
    let k = 0;
    for (let x = 1; x < held.length; x++) if (held[x].ms < held[k].ms) k = x;
    if (!(held[k].ms < ms)) return false;
    const [ev] = held.splice(k, 1);
    delete ev.row.descriptionPlain;
    descChars -= ev.len;
    st.descKept--;
    st.descDropped++;
    return true;
  };
  for await (const el of jsonArrayElements(body, spec.arrayKey, o.maxElementBytes, o.deadlineAt)) {
    st.elements++;
    st.bytes += el.length;
    const j = JSON.parse(dec.decode(el)) as J;
    const slim = pick(j, spec.keep);
    spec.reduce?.(slim);
    meta += JSON.stringify(slim).length;
    if (meta > o.maxBytes) throw new Error(`${OVERSIZE_MARKER} slim ${meta} > ${o.maxBytes}`);
    while (meta + descChars > o.descCeiling && evictOlderThan(Infinity)) { /* metadata takes precedence */ }
    const posted = sanePostedAt(spec.postedAt(j));
    if (!isDatedBefore(posted, o.freshCutoffMs)) {
      const full = spec.text(j);
      if (full) {
        const kept = full.length > o.descKeepChars ? full.slice(0, o.descKeepChars) : full;
        const ms = posted === null ? Infinity : Date.parse(posted);
        while (meta + descChars + kept.length > o.descCeiling && evictOlderThan(ms)) { /* newest first */ }
        if (meta + descChars + kept.length <= o.descCeiling) {
          slim.descriptionPlain = kept;
          descChars += kept.length;
          held.push({ ms, row: slim, len: kept.length });
          st.descKept++;
        } else st.descDropped++;
      }
    }
    out.push(slim);
  }
  st.slimBytes = meta + descChars;
  return { raw: spec.arrayKey === null ? out : { [spec.arrayKey]: out }, stats: st };
}
