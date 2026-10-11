// What a call to generate-application-answers came back with, read honestly.
//
// Sweep S11-040. apply-agent read only `data` from the drafting call. A 429,
// a 402, a 502 or a 500 left `data` null, a reply whose JSON did not parse
// came back as 200 with [], and a model that echoed a label in another case
// matched nothing. Every one of those became drafted = [], and buildPacket
// turned each required screening question into "nothing in your résumé
// supports an answer": a permanent blocker (the queue never prepares a row
// that has a packet) that told the candidate their CV was the problem when
// the drafting step was.
//
// So a failed call is a failure (the posting is left for the next run), a
// model echo is matched the way the packet matches labels, and a question the
// reply left out says so instead of blaming the résumé.
import { toDraftedAnswers, type DraftedAnswer } from "./submission-packet.ts";

/**
 * A question label as the model's echo, the packet and the sheet compare it:
 * case, spacing and the list number the prompt put in front of it ignored.
 */
export function sameQuestion(label: unknown): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d{1,2}\s*[.):-]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The model's answers, each renamed to the label that was asked, verbatim. */
export function toAskedLabels(raw: readonly unknown[], asked: readonly string[]): unknown[] {
  const byKey = new Map(asked.map((l) => [sameQuestion(l), l]));
  return raw.map((a) => {
    if (!a || typeof a !== "object") return a;
    const q = (a as { question?: unknown }).question;
    const hit = typeof q === "string" ? byKey.get(sameQuestion(q)) : undefined;
    return hit ? { ...(a as Record<string, unknown>), question: hit } : a;
  });
}

/** The note on a question the reply did not answer at all. */
export const NO_DRAFT_NOTE = "no draft came back for this question, so answer it in your own words";

export type DraftReply =
  | { ok: true; drafted: DraftedAnswer[] }
  | { ok: false; why: string };

/**
 * Read a functions.invoke reply from generate-application-answers.
 *
 * `ok: false` means the call itself failed (an error, or no answers list):
 * nothing about the résumé was learned, and the caller must not build a
 * packet from it.
 */
export function readDraftReply(
  reply: { data?: unknown; error?: unknown },
  asked: ReadonlyArray<{ label: string }>,
): DraftReply {
  if (reply.error) {
    const msg = (reply.error as { message?: unknown })?.message;
    return { ok: false, why: `the drafting call failed: ${String(msg ?? reply.error).slice(0, 120)}` };
  }
  const answers = (reply.data as { answers?: unknown } | null | undefined)?.answers;
  if (!Array.isArray(answers)) return { ok: false, why: "the drafting call answered with no list of answers" };
  const drafted = toDraftedAnswers(toAskedLabels(answers, asked.map((q) => q.label)));
  const have = new Set(drafted.map((d) => sameQuestion(d.label)));
  for (const q of asked) {
    if (!have.has(sameQuestion(q.label))) drafted.push({ label: q.label, answer: "", supported: false, note: NO_DRAFT_NOTE });
  }
  return { ok: true, drafted };
}
