import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import type { ListingJob } from "@/lib/listing/types";
import { isAutomatedAgent } from "./automation";
import { applyFeedReadGate, curveTokens, HOME_LIST_BODY, selectHomeRows, withoutFeedRead, type FeedReadCurveRow } from "./rows";

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
 *      without stamps and a late curve is ignored.
 *
 * Any failure, or a reply with nothing the rules allow, is "hidden": the page
 * drops the list and keeps "See all postings" and the field links.
 */
export type HomeRowsStatus = "off" | "loading" | "ready" | "hidden";

export interface HomeRowsState {
  status: HomeRowsStatus;
  rows: ListingJob[];
}

export const CURVE_WAIT_MS = 2500;

export interface UseHomeRowsOptions {
  /** The preview harness, which drives a browser on purpose, sets this. */
  allowAutomation?: boolean;
  now?: () => Date;
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

const within = <T,>(p: PromiseLike<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
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
    const run = async () => {
      try {
        const { data, error } = await invokeJobBoard<{ jobs?: ListingJob[] }>({ body: { ...HOME_LIST_BODY } });
        if (!alive) return;
        const jobs = !error && data && Array.isArray(data.jobs) ? data.jobs : null;
        const kept = selectHomeRows(jobs, { now: opts.now?.() });
        if (kept.length === 0) {
          setState({ status: "hidden", rows: [] });
          return;
        }
        const tokens = curveTokens(kept);
        const sb = supabase as unknown as { rpc: (fn: string, args: unknown) => PromiseLike<{ data: unknown; error: unknown }> };
        const curve = tokens.length ? await within(sb.rpc("get_company_fill_curve", { p_tokens: tokens }), CURVE_WAIT_MS) : null;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automated]);

  return state;
}
