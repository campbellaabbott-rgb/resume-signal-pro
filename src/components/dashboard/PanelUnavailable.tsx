/**
 * A PANEL WHOSE READER FAILED SAYS SO (S12-158, S14X-156). With a wrong admin
 * key, or admin-ops answering 502, a panel that printed its quiet state ("No
 * orders in last 24h", "100.0%") made a broken dashboard look like a calm day.
 * A failed read renders this in the panel's place, with the reason, and never
 * the empty state. /health-check's operations panels and its three trend cards
 * share it.
 */
export function PanelUnavailable({ why }: { why: string }) {
  return (
    <p className="text-sm text-destructive text-center py-4" role="status" data-panel-unavailable="true">
      Unavailable: this panel's reader did not answer ({why.slice(0, 140)}). That is not the same as no activity: check the admin key, or try again.
    </p>
  );
}

/** The reason a read failed, from an error object, an Error or anything thrown. */
export function unavailableReason(e: unknown): string {
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' && (e as { message: string }).message) {
    return (e as { message: string }).message;
  }
  return typeof e === 'string' && e ? e : 'no reason given';
}
