/**
 * WHO IS SELLING, FOR THE MAIL (commercial-readiness plan item 10). The two
 * strings live in ONE edge file, _shared/seller-identity.ts (wave 3: the
 * payments-account and email-ops groups each built a copy; the integration
 * keeps one source so the owner cannot fill one and miss the other). They
 * equal src/config/seller.ts (a test holds them equal); EMPTY until the owner
 * sets both, and while either is empty the footer line is "".
 *
 * Imported by the path "../_shared/seller-identity.ts" so a test can stand in
 * for the identity; the harness can stand in for this whole module too.
 */
import { SELLER_IDENTITY } from "../_shared/seller-identity.ts";

export const SELLER: { readonly legalName: string; readonly postalAddress: string } = SELLER_IDENTITY;

export type SellerIdentity = { legalName: string; postalAddress: string };

const esc = (v: string) => v.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The identity, or null while either half is unset. */
export function sellerIdentity(s: SellerIdentity = SELLER): SellerIdentity | null {
  const legalName = s.legalName.trim();
  const postalAddress = s.postalAddress.trim();
  return legalName && postalAddress ? { legalName, postalAddress } : null;
}

/** The marketing mail's sender line (name and postal address), or "" while unset. */
export function sellerFooterHtml(s: SellerIdentity = SELLER): string {
  const id = sellerIdentity(s);
  return id
    ? `<p style="font-size:11px;color:#94a3b8;text-align:center;margin:8px 0 0">${esc(id.legalName)} · ${esc(id.postalAddress)}</p>`
    : "";
}

/** The same line for a plain-text part, or "". */
export function sellerFooterText(s: SellerIdentity = SELLER): string {
  const id = sellerIdentity(s);
  return id ? `${id.legalName} · ${id.postalAddress}` : "";
}
