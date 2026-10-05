/**
 * WHAT THE ADAPTER FILLS, AND WHERE IT COMES FROM.
 *
 * THE DEFECT (register 1.13). The worker filled an adapter's identity inputs
 * only from the packet's label-keyed fields, run through a regex table: the
 * question LABELS apply-agent wrote. apply-agent's fallback form is "Full
 * name", "Email", "Phone", "Resume", which yields fullName/email/phone —
 * while Personio, Teamtailor and Pinpoint map firstName and lastName, not
 * fullName. Those inputs are in the adapter's mappedNames, so the question
 * matcher skipped them too, and the broker's live firstName/lastName never
 * reached them: the name boxes stayed empty on three of the auto-submit
 * vendors (and on any Breezy form whose questionnaire was harvested, where
 * the packet carried no identity at all). The dry run and the harness fed
 * keyed profiles directly, which is why they passed.
 *
 * NOW: the adapter's fields are built from the broker's LIVE answers — the
 * candidate's profile as it stands at send time, split into first and last
 * name the way the broker splits it. The packet's fields keep exactly one
 * job here, the cover note apply-agent tailored for this posting, which wins
 * over the standing note. Drafted answers to the employer's own questions
 * travel separately (toPrepared in index.ts) and are matched by label.
 *
 * Pure, and outside index.ts on purpose: index.ts starts the worker when
 * imported, and the test suite and the harness must be able to call this.
 */
import type { PacketFieldKey } from "./vendors/types.js";

export type PacketField = { value: string; source: string };

/** The broker's answers, as far as this needs them. */
export type IdentityWire = {
  fullName?: string | null; firstName?: string | null; lastName?: string | null;
  email?: string | null; phone?: string | null; city?: string | null; country?: string | null;
  address?: string | null; postcode?: string | null; linkedin?: string | null; website?: string | null;
  coverNote?: string | null; salaryExpectation?: string | null;
};

/**
 * Reserved key in `packet.fields` carrying a note written for THIS posting.
 * Mirrors COVER_NOTE_FIELD_KEY in supabase/functions/_shared/submission-packet.ts.
 */
export const COVER_NOTE_FIELD_KEY = "__coverNote";

/**
 * The name and contact fields an adapter may hold, which — when the form
 * shows one — must not be left empty at submit: an application with no name
 * or no reply address is not an application.
 */
export const MUST_FILL_IF_SHOWN: readonly PacketFieldKey[] = ["fullName", "firstName", "lastName", "email", "confirmEmail"];

/**
 * THE NAME AND REPLY ADDRESS AN APPLICATION CANNOT GO WITHOUT, judged from
 * the ADAPTER'S OWN MAP rather than from what its locators happened to find
 * (agents-api review of 1.13, 2026-10-05).
 *
 * The partial-application guard counts placed boxes against SHOWN boxes, and
 * a box is "shown" only when adapter.locate() finds it. A vendor that renames
 * its email input makes locate() return null: the key is then neither shown
 * nor shown-but-empty, placed/shown stays 100%, and the form goes without a
 * name or an email. Every sendable vendor's form asks for both, so a core key
 * this adapter maps, that the candidate holds a value for, and that was never
 * placed by the time the form would submit, is a selector that stopped
 * matching — and a refusal. confirmEmail is a repeat of email, not core.
 */
export const CORE_IDENTITY: readonly PacketFieldKey[] = ["fullName", "firstName", "lastName", "email"];

export function unplacedCoreIdentity(
  fieldKeys: ReadonlySet<PacketFieldKey> | undefined,
  fields: Partial<Record<PacketFieldKey, PacketField>>,
  placed: ReadonlySet<PacketFieldKey>,
): PacketFieldKey[] {
  if (!fieldKeys) return [];
  return CORE_IDENTITY.filter((k) => fieldKeys.has(k) && !!fields[k]?.value?.trim() && !placed.has(k));
}

export function identityFields(
  a: IdentityWire,
  packetFields?: Record<string, { value?: string | null; source?: string | null }> | null,
): Partial<Record<PacketFieldKey, PacketField>> {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const full = s(a.fullName);
  const parts = full.split(/\s+/).filter(Boolean);
  const first = s(a.firstName) || (parts[0] ?? "");
  const last = s(a.lastName) || (parts.length > 1 ? parts.slice(1).join(" ") : "");
  const tailored = s(packetFields?.[COVER_NOTE_FIELD_KEY]?.value);
  const values: Partial<Record<PacketFieldKey, string>> = {
    fullName: full || [first, last].filter(Boolean).join(" "),
    firstName: first,
    lastName: last,
    email: s(a.email),
    confirmEmail: s(a.email),
    phone: s(a.phone),
    city: s(a.city),
    country: s(a.country),
    address: s(a.address),
    postcode: s(a.postcode),
    linkedin: s(a.linkedin),
    website: s(a.website),
    coverNote: tailored || s(a.coverNote),
    salaryExpectation: s(a.salaryExpectation),
  };
  const out: Partial<Record<PacketFieldKey, PacketField>> = {};
  for (const [k, v] of Object.entries(values) as Array<[PacketFieldKey, string]>) {
    if (!v) continue;
    out[k] = { value: v, source: k === "coverNote" && tailored ? "drafted" : "profile" };
  }
  return out;
}
