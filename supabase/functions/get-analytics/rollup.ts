/**
 * THE DASHBOARD'S NUMBERS, FOLDED IN AS THE ROWS ARRIVE (S13-070).
 *
 * get-analytics read ab_test_events oldest first into one array and stopped
 * at 50,000 rows, so on a range holding more than that the NEWEST days were
 * never read: the trend, the funnels and the A/B counts covered the start of
 * the range and traffic looked as if it had stopped. The reader now pages
 * newest first through every row, and each page is folded into these counts
 * and dropped, so no row cap is needed to keep the isolate's memory bounded.
 * If the run's time budget ends the read early, it is the OLDEST days that
 * are partial, and the answer says from where (coveredFrom).
 *
 * Import-free, so the Node tests import it. The arithmetic is the body that
 * lived in index.ts, unchanged.
 */
export interface AnalyticsEvent {
  test_name: string;
  variant: string;
  event_type: string;
  created_at: string;
  visitor_id?: string | null;
  metadata?: { page?: string } | null;
  /** metadata->>page, when the reader selected it on its own. */
  page?: string | null;
}

type Counts = { views: number; conversions: number };

/**
 * A MILESTONE'S PLACE ON ITS OWN SCALE (S14X-189): 30s = 30, 1m = 60,
 * 2h = 7200, 25% = 25. NaN when the variant is not a milestone.
 *
 * The milestones were sorted by their digits alone, so 30s (30) came after
 * 10m (10): the Time on Page funnel read 0s, 1m, 2m, 5m, 10m, 30s and each
 * drop-off was measured between the wrong steps.
 */
export function milestoneValue(variant: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|%)?$/i.exec(String(variant).trim());
  if (!m) return NaN;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  return unit === "m" ? n * 60 : unit === "h" ? n * 3600 : n;
}

/** Milestones in the order a visitor reaches them; anything else after them, by name. */
export function orderMilestones<T extends { variant: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const x = milestoneValue(a.variant), y = milestoneValue(b.variant);
    const xn = Number.isNaN(x), yn = Number.isNaN(y);
    if (xn || yn) return xn && yn ? a.variant.localeCompare(b.variant) : xn ? 1 : -1;
    return x - y || a.variant.localeCompare(b.variant);
  });
}

/**
 * THE OWNER'S CALENDAR DAY OF AN EVENT (S14X-190). A day was the UTC date of
 * created_at while the page asked for local-midnight bounds, so "Today" could
 * draw two days and an American evening visit counted as coming back on
 * another day. The page sends its IANA zone; a missing or unknown zone keeps
 * UTC. The zone's formatter runs once per distinct minute (every zone's
 * offset is a whole number of minutes), not once per event.
 */
export function dayKeyer(timeZone?: string | null): { zone: string; dayOf: (createdAt: string) => string } {
  const utc = { zone: "UTC", dayOf: (c: string) => String(c).slice(0, 10) };
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64 || /^(Etc\/)?(UTC|GMT|Z|Zulu|UCT|Universal)$/i.test(timeZone)) return utc;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return utc;
  }
  const byMinute = new Map<number, string>();
  return {
    zone: fmt.resolvedOptions().timeZone,
    dayOf: (c: string) => {
      const t = Date.parse(String(c));
      if (!Number.isFinite(t)) return utc.dayOf(c);
      const minute = Math.floor(t / 60_000);
      const hit = byMinute.get(minute);
      if (hit) return hit;
      const parts = fmt.formatToParts(new Date(t));
      const part = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
      const day = `${part("year")}-${part("month")}-${part("day")}`;
      byMinute.set(minute, day);
      return day;
    },
  };
}

export function createRollup(pageFilter?: string | null, timeZone?: string | null) {
  const days = dayKeyer(timeZone);
  const allVisitors = new Set<string>();
  const visitorsByDay = new Map<string, Set<string>>();
  const eventsByDay = new Map<string, number>();
  const visitorFirstSeen = new Map<string, string>();
  const surfaceVisitors = new Map<string, Set<string>>();
  const metrics: Record<string, Record<string, Counts>> = {};
  const pageSpecificMetrics: Record<string, Record<string, Record<string, Counts>>> = { home: {}, pricing: {} };
  let totalEvents = 0;

  const add = (raw: AnalyticsEvent) => {
    totalEvents++;
    // AUDIENCE: people, not events.
    const vid = raw.visitor_id ?? undefined;
    const day = days.dayOf(raw.created_at);
    eventsByDay.set(day, (eventsByDay.get(day) ?? 0) + 1);
    if (vid) {
      allVisitors.add(vid);
      if (!visitorsByDay.has(day)) visitorsByDay.set(day, new Set());
      visitorsByDay.get(day)!.add(vid);
      if (!surfaceVisitors.has(raw.test_name)) surfaceVisitors.set(raw.test_name, new Set());
      surfaceVisitors.get(raw.test_name)!.add(vid);
      const prev = visitorFirstSeen.get(vid);
      if (!prev || day < prev) visitorFirstSeen.set(vid, day);
    }

    // Scroll and time milestones carry their page in the variant since
    // 2026-10-09 ('pricing:25%', S8-123); the milestone is what is counted.
    const isMilestone = raw.test_name === "scroll_depth" || raw.test_name === "time_on_page";
    const prefixed = isMilestone ? /^([a-z_]{1,20}):(.+)$/.exec(String(raw.variant)) : null;
    const event = prefixed ? { ...raw, variant: prefixed[2] } : raw;
    const eventPage = (event.page ?? event.metadata?.page) ?? prefixed?.[1];

    if (isMilestone && eventPage) {
      const pageBucket = pageSpecificMetrics[eventPage];
      if (pageBucket) {
        if (!pageBucket[event.test_name]) pageBucket[event.test_name] = {};
        if (!pageBucket[event.test_name][event.variant]) pageBucket[event.test_name][event.variant] = { views: 0, conversions: 0 };
        if (event.event_type === "view") pageBucket[event.test_name][event.variant].views++;
        else if (event.event_type === "conversion") pageBucket[event.test_name][event.variant].conversions++;
      }
    }

    // For scroll_depth and time_on_page, filter by page if not "all".
    if (pageFilter && pageFilter !== "all" && isMilestone && eventPage !== pageFilter) return;

    if (!metrics[event.test_name]) metrics[event.test_name] = {};
    if (!metrics[event.test_name][event.variant]) metrics[event.test_name][event.variant] = { views: 0, conversions: 0 };
    if (event.event_type === "view") metrics[event.test_name][event.variant].views++;
    else if (event.event_type === "conversion") metrics[event.test_name][event.variant].conversions++;
  };

  const audience = (truncated: boolean, coveredFrom: string | null) => {
    // A returning visitor is one seen on more than one distinct day.
    const daysPerVisitor = new Map<string, number>();
    for (const ids of visitorsByDay.values()) for (const id of ids) daysPerVisitor.set(id, (daysPerVisitor.get(id) ?? 0) + 1);
    let returningVisitors = 0;
    for (const n of daysPerVisitor.values()) if (n > 1) returningVisitors++;
    return {
      uniqueVisitors: allVisitors.size,
      totalEvents,
      returningVisitors,
      eventsPerVisitor: allVisitors.size ? Math.round((totalEvents / allVisitors.size) * 10) / 10 : 0,
      // Ascending by day so the dashboard can render a trend directly.
      daily: [...visitorsByDay.keys()].sort().map((day) => ({
        day,
        visitors: visitorsByDay.get(day)!.size,
        events: eventsByDay.get(day) ?? 0,
        newVisitors: [...visitorsByDay.get(day)!].filter((id) => visitorFirstSeen.get(id) === day).length,
      })),
      bySurface: [...surfaceVisitors.entries()]
        .map(([surface, ids]) => ({ surface, visitors: ids.size }))
        .sort((a, b) => b.visitors - a.visitors)
        .slice(0, 25),
      // Honest caveat the UI must surface: the read stopped before the
      // oldest rows, so the days before coveredFrom are undercounted.
      truncated,
      coveredFrom: truncated ? coveredFrom : null,
      // And on EVERY day, the read days too, new and returning are
      // approximate when the read stopped early (the fixer's review): a
      // visitor is new on the earliest day seen in the rows read, so one
      // whose first visit fell in the unread part counts as new on a later
      // day, and returning is undercounted.
      visitorSplitApproximate: truncated,
      // The zone whose calendar days these are (S14X-190): the page's, or UTC.
      dayZone: days.zone,
    };
  };

  return { add, audience, metrics, pageSpecificMetrics, get totalEvents() { return totalEvents; } };
}
