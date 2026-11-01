// Rationale: docs/job-board-index-notes.md#n1505-const-apostrophe_like
const APOSTROPHE_LIKE = "‘’‛ʼ＇";
const ANY_APOSTROPHE = new RegExp(`[${APOSTROPHE_LIKE}]`, "g");
const HAS_APOSTROPHE = new RegExp(`[${APOSTROPHE_LIKE}]`);

/** Every apostrophe-like character as the ASCII one. */
export function foldApostrophes(s: string): string {
  return s.replace(ANY_APOSTROPHE, "'");
}

/** True when two texts differ only in which apostrophe they use. */
export function sameButApostrophes(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a === b) return false;
  return foldApostrophes(a) === foldApostrophes(b);
}

/** A list request with its typed search text folded: q and location. */
export function foldTypedText<T extends Record<string, unknown>>(body: T): T {
  let out = body;
  for (const k of ["q", "location"] as const) {
    const v = body[k];
    if (typeof v === "string" && HAS_APOSTROPHE.test(v)) out = { ...out, [k]: foldApostrophes(v) };
  }
  return out;
}
