import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ListingJob } from "@/lib/listing/types";
import { isAutomatedAgent } from "./automation";
import type { FeedReadCurveRow } from "./rows";

/**
 * THE HOMEPAGE'S LIVE ROWS (corrected spec 4.2, "Data").
 *
 *   1. After first paint, and never for a crawler or a driven browser, one
 *      job-board list call: newest first, the last 7 days, no agency boards.
 *   2. selectHomeRows keeps up to five rows the board's own rules allow.
 *   3. One get_company_fill_curve call for the kept boards; a row keeps its
 *      feed-read time only where that board was read in full.
 *   4. All rows land in ONE commit, stamps included, so the reserved list box
 *      fills once and nothing in it moves afterwards. A curve that has not
 *      answered within CURVE_WAIT_MS is treated as no answer: the rows land
 *      without stamps, and the curve call is aborted.
 *   5. The list call has its own deadline (LIST_WAIT_MS): a hung call is
 *      aborted and the list is "hidden", never skeletons for good.
 *
 * Any failure, or a reply with nothing the rules allow, is "hidden": the page
 * drops the list and keeps "See all postings" and the field links.
 *
 * The code that makes the call and picks the rows (the job-board door,
 * rows.ts with the board's collision table and the feed-read gate) loads
 * when the call is made, after the first paint, not ahead of it.
 */
export type HomeRowsStatus = "off" | "loading" | "ready" | "hidden";

export interface HomeRowsState {
  status: HomeRowsStatus;
  rows: ListingJob[];
}

export const CURVE_WAIT_MS = 2500;
/**
 * The list call's deadline. A hung call would otherwise keep the skeletons
 * and aria-busy on screen for good; past this the call is aborted and the
 * list is "hidden" ("See all postings" and the field links stay).
 */
export const LIST_WAIT_MS = 8000;

export interface UseHomeRowsOptions {
  /** The preview harness, which drives a browser on purpose, sets this. */
  allowAutomation?: boolean;
  now?: () => Date;
  /** Tests only. */
  listWaitMs?: number;
  /** Tests only. */
  curveWaitMs?: number;
}

const afterFirstPaint = (fn: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  let idle: number | null = null;
  const raf = window.requestAnimationFrame(() => {
    if (typeof w.requestIdleCallback === "function") idle = w.requestIdleCallback(fn, { timeout: 600 });
    else idle = window.setTimeout(fn, 0);
  });
  return () => {
    window.cancelAnimationFrame(raf);
    if (idle !== null) {
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idle);
      window.clearTimeout(idle);
    }
  };
};

/** The call's answer, or null once `ms` has passed (when `abort` stops the call) or on any error. */
const within = <T,>(p: PromiseLike<T>, ms: number, abort?: () => void): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => { abort?.(); resolve(null); }, ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });

export function useHomeRows(opts: UseHomeRowsOptions = {}): HomeRowsState {
  const automated = !opts.allowAutomation && isAutomatedAgent();
  const [state, setState] = useState<HomeRowsState>({ status: automated ? "off" : "loading", rows: [] });

  useEffect(() => {
    if (automated) return;
    let alive = true;
    const listCall = new AbortController();
    const curveCall = new AbortController();
    const run = async () => {
      try {
        const [{ invokeJobBoard }, { applyFeedReadGate, curveTokens, HOME_LIST_BODY, selectHomeRows, withoutFeedRead }] = await Promise.all([
          import("@/lib/invoke-job-board"),
          import("./rows"),
        ]);
        if (!alive) return;
        const listed = await within(
          invokeJobBoard<{ jobs?: ListingJob[] }>({ body: { ...HOME_LIST_BODY }, signal: listCall.signal }),
          opts.listWaitMs ?? LIST_WAIT_MS,
          () => listCall.abort(),
        );
        if (!alive) return;
        const data = listed?.data;
        const jobs = listed && !listed.error && data && Array.isArray(data.jobs) ? data.jobs : null;
        const kept = selectHomeRows(jobs, { now: opts.now?.() });
        if (kept.length === 0) {
          setState({ status: "hidden", rows: [] });
          return;
        }
        const tokens = curveTokens(kept);
        type Curve = PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?: (s: AbortSignal) => Curve };
        const sb = supabase as unknown as { rpc: (fn: string, args: unknown) => Curve };
        const ask = () => {
          const q = sb.rpc("get_company_fill_curve", { p_tokens: tokens });
          return typeof q.abortSignal === "function" ? q.abortSignal(curveCall.signal) : q;
        };
        const curve = tokens.length ? await within(ask(), opts.curveWaitMs ?? CURVE_WAIT_MS, () => curveCall.abort()) : null;
        if (!alive) return;
        const curveRows = curve && !curve.error && Array.isArray(curve.data) ? (curve.data as FeedReadCurveRow[]) : null;
        setState({ status: "ready", rows: curveRows ? applyFeedReadGate(kept, curveRows) : withoutFeedRead(kept) });
      } catch {
        if (alive) setState({ status: "hidden", rows: [] });
      }
    };
    const cancel = afterFirstPaint(() => { void run(); });
    return () => {
      alive = false;
      cancel();
      listCall.abort();
      curveCall.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automated]);

  return state;
}
