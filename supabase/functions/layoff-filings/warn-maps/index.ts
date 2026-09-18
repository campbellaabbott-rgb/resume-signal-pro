// The twelve raw-state maps the spec lists, plus the two states read
// directly (their map also reads Big Local News' raw copy). Order is the
// nightly read order: the two direct feeds first, then raw states by the
// weight of matched rows lane 3 measured (CA, IA, MD, OR, WA, IL, NY, MA…).
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

export const RAW_STATE_MAPS: StateMap[] = [CA, IA, MD, OR, WA, IL, NY, MA, OH, GA, AZ, VA];
export const DIRECT_STATE_MAPS = { TX, FL };
export const ALL_STATE_MAPS: StateMap[] = [TX, FL, ...RAW_STATE_MAPS];
export { AZ, CA, FL, GA, IA, IL, MA, MD, NY, OH, OR, TX, VA, WA };
