/**
 * A CRASH'S EVENT VARIANT: WHERE IT HAPPENED, AND WHICH CRASH IT WAS.
 *
 * track-ab-event refuses a variant over 30 characters, and both dedup layers
 * (the transport per tab session, the writer for a day for a view) key on
 * [test, variant, type] per visitor. One variant per boundary therefore kept
 * only a visitor's first crash. So the variant is the place, cut to fit, a
 * colon and an 8-hex hash of the message: a different crash is a different
 * key, the same crash again is the same key. The message itself rides in
 * metadata.
 */
export const VARIANT_MAX_CHARS = 30;

/** FNV-1a over the message, 8 hex characters. Not a secret, only a name. */
function tag(message: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < message.length; i++) {
    h ^= message.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function crashVariant(place: string, message: string): string {
  return `${place.slice(0, VARIANT_MAX_CHARS - 9)}:${tag(message)}`;
}
