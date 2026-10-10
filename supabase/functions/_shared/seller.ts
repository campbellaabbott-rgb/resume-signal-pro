/**
 * WHO IS SELLING, FOR THE MAIL (commercial-readiness plan item 10). The same
 * two strings as src/config/seller.ts (a test holds them equal); EMPTY until
 * the owner sets both, and while either is empty the footer line is "".
 *
 * NO IMPORTS: vitest runs this file, and the harness can stand in for it.
 */
export const SELLER = {
  legalName: "",
  postalAddress: "",
} as const;

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
