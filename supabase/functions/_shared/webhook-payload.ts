// WHAT stripe-webhook KEEPS OF AN EVENT IT RECEIVES.
//
// Pure, no imports: stripe-webhook uses it, and the tests execute it.
//
// webhook_events.payload is the Stripe object an event carried, kept for
// debugging and for get_webhook_health. Until 2026-10-04 that included, for
// every full-analysis checkout, metadata.resumeData: the first 500 characters
// of the buyer's résumé, which create-checkout had copied into the session.
// create-checkout no longer writes it, but sessions minted before that deploy
// still carry it, and Stripe keeps sending their events (expiry, retries,
// refunds), so the webhook drops the key on the way in.
//
// The database drops the same keys again, in a trigger on webhook_events
// (20261004150000), so an older deployment of this function, or any other
// writer, cannot put them back. The two lists are one list: the migration's
// array is compared with this one by src/test/a-resume-never-rides-a-stripe-session.test.ts.

/** Metadata keys that have carried résumé text into a Stripe object. */
export const RESUME_BEARING_METADATA_KEYS: readonly string[] = ["resumeData"];

type WithMetadata = { metadata?: Record<string, unknown> | null } & Record<string, unknown>;

/**
 * The event object as it may be stored: a shallow copy whose metadata no
 * longer holds any résumé-bearing key. Everything else, including the rest of
 * the metadata, is kept exactly as Stripe sent it.
 */
export function withoutResumeText<T>(object: T): T {
  if (!object || typeof object !== "object" || Array.isArray(object)) return object;
  const o = object as unknown as WithMetadata;
  const metadata = o.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return object;
  if (!RESUME_BEARING_METADATA_KEYS.some((k) => k in metadata)) return object;
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!RESUME_BEARING_METADATA_KEYS.includes(k)) kept[k] = v;
  }
  return { ...o, metadata: kept } as unknown as T;
}
