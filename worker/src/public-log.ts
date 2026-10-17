/**
 * What the worker's stdout may say (L12-09, S11-046).
 *
 * The worker runs on GitHub Actions in a PUBLIC repository, so every log line
 * is world-readable. The first hardening replaced URLs and the quoted text
 * after `page said:`, and still printed candidates' details two ways: a
 * control's read-back ("field kept <value>") went out whole, and a page
 * excerpt with a double quote inside it ended the match early, so the rest of
 * the excerpt (email, phone, postcode) printed.
 *
 * So a reason is never printed as text by default. It is printed as its stage
 * from refusal.ts's closed list, the same reading the aggregate counts; the
 * full sentence still reaches the candidate's own record through the broker.
 * Any other free text (a broker error, an exception) goes through the
 * scrubber the public projection uses. WORKER_VERBOSE_LOGS=1 restores the
 * sentence for an operator watching their own terminal.
 */
import { classifyRefusal, scrubWording } from "./refusal.js";

/** A refusal or uncertain reason as the public log prints it. */
export function publicReason(reason: string, verbose: boolean): string {
  return verbose ? reason : `stage ${classifyRefusal(reason).stage}`;
}

/** Free text that is not a reason (a broker error, an exception message). */
export function publicText(text: string, verbose: boolean): string {
  return verbose ? text : scrubWording(text);
}
