// Whether a refresh worker may start a fetch now: one gate for the queue loop and the light re-read.
// Rationale: docs/job-board-index-notes.md#n423-one-start-gate

/** "ok", or the first gate that refused. "reserve" alone means wait: the others defer. */
export type StartVerdict = "ok" | "landed" | "boards" | "wall" | "heap" | "reserve";

export interface StartState {
  /** Postings landed this slice, and the worst case still in flight. */
  fetched: number;
  inFlight: number;
  postingBudget: number;
  elapsedMs: number;
  wallBudgetMs: number;
  /** undefined when the runtime cannot measure it: never a refusal. */
  heapMb: number | undefined;
  heapLimitMb: number;
  /** A new board only. A re-read is the board already started, so it passes no board count. */
  boards?: { done: number; budget: number };
}

/** The gates in the order the queue loop has always checked them. */
export function startGate(g: StartState): StartVerdict {
  if (g.fetched >= g.postingBudget) return "landed";
  if (g.boards && g.boards.done >= g.boards.budget) return "boards";
  if (g.elapsedMs >= g.wallBudgetMs) return "wall";
  if (g.heapMb !== undefined && g.heapMb >= g.heapLimitMb) return "heap";
  if (g.fetched + g.inFlight >= g.postingBudget) return "reserve";
  return "ok";
}
