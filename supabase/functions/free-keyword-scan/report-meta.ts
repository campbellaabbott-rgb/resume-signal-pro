/**
 * Two pieces of the free report's specimen header that must be exactly true,
 * pulled out of index.ts so the Node suite runs the real code.
 */

export interface ScoreAuditItem { label: string; earned: number; possible: number; detail: string }
export interface ScoreAudit { total: number; items: ScoreAuditItem[] }

const COMPONENTS = [
  { key: "keywords", label: "Keyword coverage", weight: 0.35, possible: 35 },
  { key: "format", label: "Format & parseability", weight: 0.30, possible: 30 },
  { key: "quantification", label: "Quantified impact", weight: 0.25, possible: 25 },
] as const;
const CONTENT_POSSIBLE = 10;

/**
 * "Why {score}? Every point, accounted for": items that always sum to the
 * score the report states (sweep S8-072). The three components follow the
 * sub-scores the report shows; the fourth absorbs the rest up to its 10. When
 * the sub-scores do not track the final score (it is held within 12 points of
 * the rule-based score), the components are scaled to it, each within its own
 * maximum, instead of the residual being clamped and the items summing to
 * some other number.
 */
export function buildScoreAudit(input: {
  total: number;
  breakdown: { keywords?: unknown; format?: unknown; quantification?: unknown } | null;
  details: { keywords: string; format: string; quantification: string; content: string };
}): ScoreAudit {
  const total = Math.max(0, Math.min(100, Math.round(input.total)));
  const sub = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50);
  const raw = COMPONENTS.map((c) => sub(input.breakdown?.[c.key]) * c.weight);
  const rounded = raw.map(Math.round);
  const residual = total - rounded.reduce((a, b) => a + b, 0);

  let earned: number[];
  let content: number;
  if (residual >= 0 && residual <= CONTENT_POSSIBLE) {
    earned = rounded;
    content = residual;
  } else {
    content = Math.round(Math.max(0, Math.min(CONTENT_POSSIBLE, total - raw.reduce((a, b) => a + b, 0))));
    earned = allocate(total - content, raw, COMPONENTS.map((c) => c.possible));
  }

  const detailOf = { keywords: input.details.keywords, format: input.details.format, quantification: input.details.quantification };
  return {
    total,
    items: [
      ...COMPONENTS.map((c, i) => ({ label: c.label, earned: earned[i], possible: c.possible, detail: detailOf[c.key] })),
      { label: "Content signals", earned: content, possible: CONTENT_POSSIBLE, detail: input.details.content },
    ],
  };
}

/** `amount` whole points shared in proportion to `weights`, none above its cap, summing exactly. */
function allocate(amount: number, weights: number[], caps: number[]): number[] {
  const share = new Array(weights.length).fill(0);
  let left = amount;
  let open = weights.map((_, i) => i);
  // Water-fill: proportional shares, capping any that overflow, until it fits.
  while (left > 1e-9 && open.length > 0) {
    const w = open.map((i) => (weights[i] > 0 ? weights[i] : 0));
    const sum = w.reduce((a, b) => a + b, 0);
    const parts = open.map((_, k) => (sum > 0 ? (w[k] / sum) * left : left / open.length));
    let capped = false;
    open.forEach((i, k) => {
      if (share[i] + parts[k] > caps[i]) { left -= caps[i] - share[i]; share[i] = caps[i]; capped = true; }
    });
    if (capped) { open = open.filter((i) => share[i] < caps[i]); continue; }
    open.forEach((i, k) => { share[i] += parts[k]; });
    left = 0;
  }
  // Whole points by largest remainder, so the sum is exactly `amount`.
  const floor = share.map(Math.floor);
  let rest = amount - floor.reduce((a, b) => a + b, 0);
  const order = share.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    if (floor[i] < caps[i]) { floor[i]++; rest--; }
  }
  return floor;
}

/**
 * The report's id: every input that keys the report cache, plus the score it
 * states (sweep S8-069). A rescan of the same file within the cache's 7 days
 * returns the stored report under this id; a re-drawn score later, or the
 * same résumé against another posting, is another report with another id
 * (and its own mail allowance).
 */
export async function reportIdFor(reportCacheKey: string, score: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${reportCacheKey}|${score}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12).toUpperCase();
}
