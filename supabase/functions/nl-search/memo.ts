/**
 * A QUERY ASKED TWICE IS PARSED ONCE (cost audit 2026-11-08).
 *
 * Every typed sentence on the board was a model call, the same sentence again
 * included. The parse of a sentence depends on nothing but the sentence (one
 * fixed prompt, one validator), so an isolate keeps what it answered, keyed
 * by the sentence with its case, Unicode form and spacing evened out.
 *
 * Bounded twice: at most MEMO_LIMIT sentences, the least recently asked
 * dropped first, and none older than MEMO_TTL_MS. Only an answer the
 * validator produced is kept; a refusal, a timeout or a failed parse is
 * never remembered, so the next ask tries the model again.
 *
 * In-isolate on purpose: nothing is written anywhere, and a deploy starts
 * every isolate empty.
 *
 * Pure: no imports.
 */

export const MEMO_LIMIT = 256;
export const MEMO_TTL_MS = 6 * 60 * 60 * 1000;

/** The memo's key for a sentence: one Unicode form, lower case, single spaces, trimmed. */
export function normaliseQuery(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export class ParseMemo<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(private readonly limit = MEMO_LIMIT, private readonly ttlMs = MEMO_TTL_MS, private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.entries.size;
  }

  /** The kept answer for this key, or undefined when none is kept or it is past its time. */
  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Asked again: it moves to the back of the line to be dropped.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
