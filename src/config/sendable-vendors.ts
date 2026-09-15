// THE VENDORS THE APPLY AGENT CAN SUBMIT ON, MIRRORED FOR PUBLIC COPY.
//
// The authority is `SENDABLE_VENDORS` in supabase/functions/_shared/
// apply-automation.ts (Deno), which the queue, the worker and the board's
// `status.sendable` all obey. A frontend page cannot import a Deno module, so
// this is its copy — and a copy is exactly what drifts: the board pitch once
// said "four hiring systems — about 6%" while the Deno list held five.
//
// Two rules keep this honest:
//   1. src/test/the-page-says-six-and-the-server-says-eleven.test.ts reads the
//      Deno file and fails when this set differs from it.
//   2. Copy renders the NAMES from SENDABLE_VENDOR_LABELS and the COUNT from
//      `.length` — never spelled, so a change here is a change everywhere.
//
// Labels come from the vendor table the board's source note already uses, so
// a vendor is spelled one way across the site.
import { ATS_VENDORS } from "./ats-vendors";

export const SENDABLE_VENDOR_KEYS: readonly string[] = ["breezy", "oracle", "personio", "pinpoint", "teamtailor"];

/** Display names, in the mirror's order, e.g. "Breezy, Oracle, Personio". */
export const SENDABLE_VENDOR_LABELS: readonly string[] = SENDABLE_VENDOR_KEYS.map(
  (k) => ATS_VENDORS.find((v) => v.key === k)?.label ?? k,
);

/** "A, B, C and D" — English prose form for the page. */
export const SENDABLE_VENDOR_SENTENCE = SENDABLE_VENDOR_LABELS.length > 1
  ? `${SENDABLE_VENDOR_LABELS.slice(0, -1).join(", ")} and ${SENDABLE_VENDOR_LABELS[SENDABLE_VENDOR_LABELS.length - 1]}`
  : SENDABLE_VENDOR_LABELS.join("");
