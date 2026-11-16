// The raw-state maps the spec lists (eleven read; Georgia is in NOT_READ),
// plus the two states read directly (their map also reads Big Local News'
// raw copy). Order is the nightly read order: the two direct feeds first,
// then raw states by the weight of matched rows lane 3 measured (CA, IA,
// MD, OR, WA, IL, NY, MA…).
import type { StateMap } from "./types.ts";
import { CA } from "./ca.ts";
import { IA } from "./ia.ts";
import { MD } from "./md.ts";
import { OR } from "./or.ts";
import { WA } from "./wa.ts";
import { IL } from "./il.ts";
import { NY } from "./ny.ts";
import { MA } from "./ma.ts";
import { OH } from "./oh.ts";
import { GA } from "./ga.ts";
import { AZ } from "./az.ts";
import { VA } from "./va.ts";
import { TX } from "./tx.ts";
import { FL } from "./fl.ts";

export const RAW_STATE_MAPS: StateMap[] = [CA, IA, MD, OR, WA, IL, NY, MA, OH, AZ, VA];

/**
 * States not read, each with the reason (S14X-036). Georgia's raw file
 * carries no notice, received or posted date at all -- only the six
 * "Date of Separation" columns, which are the layoff's own dates, not the
 * day it was announced -- so no row could be dated without inventing a
 * date. Its map stays for the day Big Local News adds one.
 */
export const NOT_READ: Readonly<Record<string, string>> = {
  GA: "the raw file carries no notice, received or posted date, only separation dates",
};
export const DIRECT_STATE_MAPS = { TX, FL };
export const ALL_STATE_MAPS: StateMap[] = [TX, FL, ...RAW_STATE_MAPS];
export { AZ, CA, FL, GA, IA, IL, MA, MD, NY, OH, OR, TX, VA, WA };
