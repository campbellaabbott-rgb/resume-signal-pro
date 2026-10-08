/**
 * A FUNCTION'S BUILD STAMP, COMPARED AS A DATE, NOT AS A SPELLING.
 *
 * Every edge function answers `x-fn-build: <fn>.<YYYY-MM-DD>.<n>`. A test that
 * pins one exact day goes red on the next wave's bump with nothing wrong, so
 * the fix gets made by editing the date and nobody reads the failure. This
 * asks the question the pin meant: is it THIS function, at this build or a
 * later one?
 */
export function buildIsAtLeast(stamp: string | null | undefined, fn: string, minDay: string, minSeq = 1): boolean {
  const m = String(stamp ?? "").match(/^(.+)\.(\d{4}-\d{2}-\d{2})\.(\d+)$/);
  if (!m || m[1] !== fn) return false;
  if (m[2] !== minDay) return m[2] > minDay;
  return Number(m[3]) >= minSeq;
}
