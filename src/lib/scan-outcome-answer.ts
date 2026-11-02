/**
 * What record_scan_outcome answered (register S13-057). The function answers
 * true when it stored the outcome and false when its write budget refused
 * it; supabase-js resolves an error rather than throwing. Only true is an
 * answer that was kept: false, an error or no answer at all was not, and the
 * page must not thank anyone for it.
 */
export type ScanOutcomeRpcAnswer = { data?: unknown; error?: unknown } | null | undefined;

export function outcomeWasStored(res: ScanOutcomeRpcAnswer): boolean {
  return !!res && !res.error && res.data === true;
}
